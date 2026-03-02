import { discoverMhlwExcelUrls, DRUG_CATEGORIES, type DiscoveredFile, type MhlwIndexResult } from './mhlw-index-scraper';
import {
  getSourceStatesByPrefix,
  upsertSourceState,
  SOURCE_KEY_INDEX,
  sourceKeyForFile,
  type SourceState,
} from './drug-master-source-state-service';
import {
  syncDrugMaster,
  createSyncLog,
  completeSyncLog,
} from './drug-master-service';
import { parseMhlwDrugFile, type ParsedDrugRow } from './drug-master-parser-service';
import { logger } from './logger';
import { createPinnedDnsAgent, validateExternalHttpsUrl } from '../utils/network-utils';
import { downloadResponseBuffer, fetchWithTimeout, MHLW_MAX_DOWNLOAD_SIZE, MHLW_FETCH_TIMEOUT_MS, MHLW_DEFAULT_FETCH_RETRIES, type FetchDispatcher } from '../utils/http-utils';
import { getErrorMessage } from '../middleware/error-handler';
import { sha256 } from '../utils/crypto-utils';

const FETCH_RETRIES = MHLW_DEFAULT_FETCH_RETRIES;

function allowPartialIndexSync(): boolean {
  return process.env.DRUG_MASTER_ALLOW_PARTIAL_INDEX_SYNC === 'true';
}

interface FileProcessResult {
  category: string;
  url: string;
  contentHash: string;
  changed: boolean;
  rows: ParsedDrugRow[];
}

interface DownloadedFileResult {
  category: string;
  url: string;
  contentHash: string;
  changed: boolean;
  contentType: string | null;
  buffer: Buffer;
}

interface ValidatedDiscoveredFile {
  hostname: string;
  resolvedAddresses: string[];
}


/**
 * 1ファイルをダウンロード → ハッシュ比較まで実行
 * 実データのパースは「変更あり判定後」にまとめて行う
 */
async function downloadFileForSync(
  file: DiscoveredFile,
  dispatcher: FetchDispatcher,
  existingStates: Map<string, SourceState>,
): Promise<DownloadedFileResult> {
  const sourceKey = sourceKeyForFile(file.category);
  const existingState = existingStates.get(sourceKey) ?? null;

  const response = await fetchWithTimeout(file.url, {
    timeoutMs: MHLW_FETCH_TIMEOUT_MS,
    retry: { retries: FETCH_RETRIES },
    redirect: 'manual',
    dispatcher,
    headers: {
      'User-Agent': 'DeadStockSolution-DrugMasterSync/1.0',
    },
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(`リダイレクト応答は許可されていません (${file.category}): ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`ダウンロード失敗 (${file.category}): ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type');
  const buffer = await downloadResponseBuffer(response, MHLW_MAX_DOWNLOAD_SIZE);
  const contentHash = sha256(buffer);
  const changed = !existingState?.contentHash || existingState.contentHash !== contentHash;

  return {
    category: file.category,
    url: file.url,
    contentHash,
    changed,
    contentType,
    buffer,
  };
}

async function validateDiscoveredFileUrl(file: DiscoveredFile): Promise<ValidatedDiscoveredFile> {
  const validated = await validateExternalHttpsUrl(file.url);
  if (!validated.ok) {
    throw new Error(`MHLW URL 検証失敗 (${file.category}): ${validated.reason}`);
  }

  return {
    hostname: validated.hostname ?? new URL(file.url).hostname,
    resolvedAddresses: validated.resolvedAddresses,
  };
}

export interface MultiFileSyncResult {
  indexUrl: string;
  discoveredFiles: DiscoveredFile[];
  allUnchanged: boolean;
  syncResult?: {
    itemsProcessed: number;
    itemsAdded: number;
    itemsUpdated: number;
    itemsDeleted: number;
  };
}

/**
 * MHLW マルチファイル同期を実行する
 *
 * 1. インデックスページから Excel URL 4件を発見
 * 2. 各ファイルの content_hash を DB と比較
 * 3. 全件 unchanged なら同期不要で終了
 * 4. 1件でも changed があれば全ファイルをパースして行データをマージ
 * 5. マージした全行を syncDrugMaster() に渡す
 * 6. 成功時に各ファイルの content_hash を DB 更新
 */
export async function runMultiFileSync(): Promise<MultiFileSyncResult> {
  // Step 1: Excel URL を発見
  const indexResult: MhlwIndexResult = await discoverMhlwExcelUrls();

  // インデックスページの状態を記録
  await upsertSourceState(SOURCE_KEY_INDEX, {
    url: indexResult.indexUrl,
    lastCheckedAt: new Date().toISOString(),
  });

  if (indexResult.files.length === 0) {
    throw new Error('インデックスページから Excel ファイルが見つかりません');
  }

  // カテゴリの検証（4カテゴリ全てが揃っているか警告）
  const foundCategories = new Set(indexResult.files.map((f) => f.category));
  const missingCategories = DRUG_CATEGORIES.filter((c) => !foundCategories.has(c));
  if (missingCategories.length > 0) {
    if (!allowPartialIndexSync()) {
      throw new Error(
        `MHLW必須カテゴリが不足しています: ${missingCategories.join(', ')} ` +
        '(必要であれば DRUG_MASTER_ALLOW_PARTIAL_INDEX_SYNC=true で一時的に許可)',
      );
    }
    logger.warn('MHLW multi-file sync: some categories not found', {
      missing: missingCategories,
      found: Array.from(foundCategories),
      allowPartialIndexSync: true,
    });
  }

  // 既存のソース状態を一括取得（N+1 → 1 クエリ）
  const existingStates = new Map<string, SourceState>();
  const allFileStates = await getSourceStatesByPrefix('drug:file:');
  for (const state of allFileStates) {
    existingStates.set(state.sourceKey, state);
  }

  // 全ファイルを HTTPS + DNS ピンニング対象として検証
  const validatedFiles = await Promise.all(indexResult.files.map((file) => validateDiscoveredFileUrl(file)));
  const representative = validatedFiles[0];
  const allSameHost = validatedFiles.every((entry) => entry.hostname === representative.hostname);
  if (!allSameHost) {
    throw new Error('MHLW マルチファイル同期エラー: 取得対象ファイルのホストが一致しません');
  }

  // 共有 DNS agent を作成（全ファイル同一ホストのみ許可）
  const sharedAgent = createPinnedDnsAgent(
    representative.hostname,
    representative.resolvedAddresses,
  );
  const dispatcher = sharedAgent as unknown as FetchDispatcher;

  try {
    // Step 2-4: 各ファイルをダウンロード & パースを統合実行
    logger.info('MHLW multi-file sync: downloading and parsing files', {
      fileCount: indexResult.files.length,
    });

    const results = await Promise.allSettled(
      indexResult.files.map((file) => downloadFileForSync(file, dispatcher, existingStates)),
    );

    // 全体中止チェック: 1つでも失敗したら中止
    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (failures.length > 0) {
      const errorMessages = failures.map((f) => getErrorMessage(f.reason));
      throw new Error(
        `ファイル処理に失敗 (${failures.length}/${indexResult.files.length}件): ${errorMessages.join('; ')}`,
      );
    }

    const successResults = results.map(
      (r) => (r as PromiseFulfilledResult<DownloadedFileResult>).value,
    );

    // 全て変更なしなら同期不要
    const hasAnyChange = successResults.some((r) => r.changed);
    if (!hasAnyChange) {
      logger.info('MHLW multi-file sync: all files unchanged, skipping sync');

      // lastCheckedAt だけ更新
      const now = new Date().toISOString();
      await Promise.all(
        successResults.map((r) =>
          upsertSourceState(sourceKeyForFile(r.category), {
            url: r.url,
            contentHash: r.contentHash,
            lastCheckedAt: now,
          }),
        ),
      );

      return {
        indexUrl: indexResult.indexUrl,
        discoveredFiles: indexResult.files,
        allUnchanged: true,
      };
    }

    // 1件でも変更がある場合は、未変更カテゴリも含めて全量をパースして同期する
    const parsedResults: FileProcessResult[] = [];
    for (const fileResult of successResults) {
      const rows = await parseMhlwDrugFile(fileResult.url, fileResult.contentType, fileResult.buffer);
      parsedResults.push({
        category: fileResult.category,
        url: fileResult.url,
        contentHash: fileResult.contentHash,
        changed: fileResult.changed,
        rows,
      });
    }

    // マージ
    const mergedRows: ParsedDrugRow[] = [];
    for (const { rows } of parsedResults) {
      mergedRows.push(...rows);
    }

    if (mergedRows.length === 0) {
      throw new Error('全ファイルから有効なデータが見つかりません');
    }

    logger.info('MHLW multi-file sync: merged rows', {
      totalRows: mergedRows.length,
      perCategory: parsedResults.map((p) => ({ category: p.category, count: p.rows.length })),
    });

    // Step 5: 同期実行
    const syncLog = await createSyncLog(
      'auto',
      `MHLW自動取得(${indexResult.files.length}ファイル): ${indexResult.indexUrl}`,
      null,
    );
    const revisionDate = new Date().toISOString().slice(0, 10);

    try {
      const syncResult = await syncDrugMaster(mergedRows, syncLog.id, revisionDate);
      await completeSyncLog(syncLog.id, 'success', syncResult);

      // Step 6: 成功時に状態を更新
      const now = new Date().toISOString();
      await Promise.all(
        parsedResults.map((r) =>
          upsertSourceState(sourceKeyForFile(r.category), {
            url: r.url,
            contentHash: r.contentHash,
            lastCheckedAt: now,
            lastChangedAt: r.changed ? now : undefined,
            metadataJson: JSON.stringify({ fileCategory: r.category }),
          }),
        ),
      );

      logger.info('MHLW multi-file sync: completed successfully', {
        processed: syncResult.itemsProcessed,
        added: syncResult.itemsAdded,
        updated: syncResult.itemsUpdated,
        deleted: syncResult.itemsDeleted,
      });

      return {
        indexUrl: indexResult.indexUrl,
        discoveredFiles: indexResult.files,
        allUnchanged: false,
        syncResult,
      };
    } catch (syncErr) {
      await completeSyncLog(syncLog.id, 'failed', {
        itemsProcessed: 0,
        itemsAdded: 0,
        itemsUpdated: 0,
        itemsDeleted: 0,
      }, getErrorMessage(syncErr));
      throw syncErr;
    }
  } finally {
    await sharedAgent.close().catch(() => undefined);
  }
}
