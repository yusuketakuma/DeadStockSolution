import { logger } from './logger';
import { validateExternalHttpsUrl, createPinnedDnsAgent } from '../utils/network-utils';
import { fetchWithTimeout, type FetchDispatcher } from '../utils/http-utils';

const MHLW_PORTAL_URL = 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000078916.html';
const ALLOWED_HOST_PATTERN = /\.mhlw\.go\.jp$/;
const FETCH_TIMEOUT_MS = 30_000;

/** MHLW 薬価基準の4カテゴリ */
export const DRUG_CATEGORIES = ['内用薬', '外用薬', '注射薬', '歯科用薬剤'] as const;
export type DrugCategory = typeof DRUG_CATEGORIES[number];

export interface DiscoveredFile {
  category: DrugCategory;
  url: string;
  label: string;
}

export interface MhlwIndexResult {
  indexUrl: string;
  files: DiscoveredFile[];
}

interface PinnedDispatcherContext {
  hostname: string;
  dispatcher: FetchDispatcher;
  close: () => Promise<void>;
}

interface PinnedTargetValidation {
  hostname: string;
  resolvedAddresses: string[];
}

function validateMhlwHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_HOST_PATTERN.test(parsed.hostname);
  } catch {
    return false;
  }
}

function resolveRelativeUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return '';
  }
}

function collectValidatedCandidates(html: string, baseUrl: string, pattern: RegExp): string[] {
  let match: RegExpExecArray | null;
  const candidates: string[] = [];
  while ((match = pattern.exec(html)) !== null) {
    const resolved = resolveRelativeUrl(baseUrl, match[1]);
    if (resolved && validateMhlwHost(resolved)) {
      candidates.push(resolved);
    }
  }
  return candidates;
}

function selectLatestCandidate(candidates: string[]): string | null {
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => {
    const numA = (a.match(/\d{8}/) || ['0'])[0];
    const numB = (b.match(/\d{8}/) || ['0'])[0];
    return numB.localeCompare(numA);
  });
  return candidates[0];
}

function dedupeFilesByCategory(results: DiscoveredFile[]): DiscoveredFile[] {
  const seen = new Set<string>();
  return results.filter((file) => {
    if (seen.has(file.category)) return false;
    seen.add(file.category);
    return true;
  });
}

async function createPinnedDispatcherContext(url: string, errorLabel: string): Promise<PinnedDispatcherContext> {
  const validated = await validatePinnedTarget(url, errorLabel);
  const pinnedAgent = createPinnedDnsAgent(validated.hostname, validated.resolvedAddresses);
  return {
    hostname: validated.hostname,
    dispatcher: pinnedAgent as unknown as FetchDispatcher,
    close: () => pinnedAgent.close().catch(() => undefined),
  };
}

async function validatePinnedTarget(url: string, errorLabel: string): Promise<PinnedTargetValidation> {
  const validated = await validateExternalHttpsUrl(url);
  if (!validated.ok) {
    throw new Error(`${errorLabel} URL の検証に失敗: ${validated.reason}`);
  }
  return {
    hostname: validated.hostname ?? new URL(url).hostname,
    resolvedAddresses: validated.resolvedAddresses,
  };
}

const CATEGORY_MAP: Record<string, DrugCategory> = {
  '内用薬': '内用薬',
  '外用薬': '外用薬',
  '注射薬': '注射薬',
  '歯科': '歯科用薬剤',
  '歯科用薬剤': '歯科用薬剤',
};

function inferCategoryFromLabel(label: string): DrugCategory | null {
  for (const [keyword, category] of Object.entries(CATEGORY_MAP)) {
    if (label.includes(keyword)) return category;
  }
  return null;
}

function inferCategoryFromFilename(url: string): DrugCategory | null {
  const filename = url.split('/').pop() || '';
  // MHLW 命名規則: _01=内用薬, _02=外用薬, _03=注射薬, _04=歯科用薬剤
  if (/_01[\._]/.test(filename) || filename.endsWith('_01.xlsx') || filename.endsWith('_01.xls')) return '内用薬';
  if (/_02[\._]/.test(filename) || filename.endsWith('_02.xlsx') || filename.endsWith('_02.xls')) return '外用薬';
  if (/_03[\._]/.test(filename) || filename.endsWith('_03.xlsx') || filename.endsWith('_03.xls')) return '注射薬';
  if (/_04[\._]/.test(filename) || filename.endsWith('_04.xlsx') || filename.endsWith('_04.xls')) return '歯科用薬剤';
  return null;
}

async function fetchHtml(url: string, dispatcher?: FetchDispatcher): Promise<string> {
  const response = await fetchWithTimeout(url, {
    timeoutMs: FETCH_TIMEOUT_MS,
    redirect: 'manual',
    dispatcher,
    headers: {
      'User-Agent': 'DeadStockSolution-MhlwIndexScraper/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Redirect response is not allowed for ${url}: ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

/**
 * 親ポータルページから最新の「薬価基準収載品目リスト」インデックスページURLを発見
 */
export function extractLatestIndexUrl(html: string, baseUrl: string): string | null {
  // パターン: /topics/YYYY/MM/tp{date}-01_01.html 等
  const linkPattern = /href=["']([^"']*\/topics\/\d{4}\/\d{2}\/tp\d+-01[^"']*\.html)["']/gi;
  const candidates = collectValidatedCandidates(html, baseUrl, linkPattern);

  if (candidates.length === 0) {
    // フォールバック: 薬価基準関連リンクを広く探す
    const broadPattern = /href=["']([^"']*(?:yakka|薬価)[^"']*\.html)["']/gi;
    candidates.push(...collectValidatedCandidates(html, baseUrl, broadPattern));
  }

  return selectLatestCandidate(candidates);
}

/**
 * インデックスページ HTML から Excel ファイル URL とカテゴリを抽出
 */
export function extractExcelUrls(html: string, baseUrl: string): DiscoveredFile[] {
  const results: DiscoveredFile[] = [];
  // Excel ファイルリンクを正規表現で抽出
  // <a> タグ内のテキストとhrefを取得
  const linkPattern = /<a\s[^>]*href=["']([^"']*\.xlsx?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html)) !== null) {
    const href = match[1];
    const linkText = match[2].replace(/<[^>]+>/g, '').trim();
    const resolved = resolveRelativeUrl(baseUrl, href);

    if (!resolved || !validateMhlwHost(resolved)) continue;

    const category: DrugCategory | null = inferCategoryFromLabel(linkText)
      ?? inferCategoryFromFilename(resolved)
      ?? null;

    if (category) {
      results.push({
        category,
        url: resolved,
        label: linkText || category,
      });
    }
  }

  return dedupeFilesByCategory(results);
}

/**
 * MHLW ポータルから最新の薬価基準 Excel URL を自動発見する
 *
 * 1. 親ポータルを GET
 * 2. 最新インデックスページリンクを抽出
 * 3. インデックスページを GET
 * 4. Excel ファイル URL 4件を抽出
 */
export async function discoverMhlwExcelUrls(portalUrl: string = MHLW_PORTAL_URL): Promise<MhlwIndexResult> {
  if (!validateMhlwHost(portalUrl)) {
    throw new Error(`ポータル URL のホスト名が *.mhlw.go.jp ではありません: ${portalUrl}`);
  }

  const portalContext = await createPinnedDispatcherContext(portalUrl, 'ポータル');

  try {
    // Step 1: 親ポータルを取得
    logger.info('MHLW index scraper: fetching portal page', { url: portalUrl });
    const portalHtml = await fetchHtml(portalUrl, portalContext.dispatcher);

    // Step 2: 最新インデックスページ URL を発見
    const indexUrl = extractLatestIndexUrl(portalHtml, portalUrl);
    if (!indexUrl) {
      throw new Error('ポータルページから薬価基準インデックスページのリンクが見つかりません');
    }

    logger.info('MHLW index scraper: found index page', { indexUrl });

    // Step 3: インデックスページを取得（HTTPS + DNS pinning を再検証、同一ホストならエージェント再利用）
    const indexValidation = await validatePinnedTarget(indexUrl, 'インデックスページ');
    const sameHost = portalContext.hostname === indexValidation.hostname;
    const indexContext = sameHost
      ? null
      : createPinnedDnsAgent(indexValidation.hostname, indexValidation.resolvedAddresses);

    try {
      const indexHtml = await fetchHtml(
        indexUrl,
        sameHost ? portalContext.dispatcher : indexContext as unknown as FetchDispatcher,
      );

      // Step 4: Excel URL を抽出
      const files = extractExcelUrls(indexHtml, indexUrl);

      logger.info('MHLW index scraper: discovered files', {
        indexUrl,
        fileCount: files.length,
        categories: files.map((f) => f.category),
      });

      return { indexUrl, files };
    } finally {
      if (indexContext) {
        await indexContext.close().catch(() => undefined);
      }
    }
  } finally {
    await portalContext.close();
  }
}
