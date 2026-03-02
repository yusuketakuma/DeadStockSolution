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
  let match: RegExpExecArray | null;
  const candidates: string[] = [];

  while ((match = linkPattern.exec(html)) !== null) {
    const resolved = resolveRelativeUrl(baseUrl, match[1]);
    if (resolved && validateMhlwHost(resolved)) {
      candidates.push(resolved);
    }
  }

  if (candidates.length === 0) {
    // フォールバック: 薬価基準関連リンクを広く探す
    const broadPattern = /href=["']([^"']*(?:yakka|薬価)[^"']*\.html)["']/gi;
    while ((match = broadPattern.exec(html)) !== null) {
      const resolved = resolveRelativeUrl(baseUrl, match[1]);
      if (resolved && validateMhlwHost(resolved)) {
        candidates.push(resolved);
      }
    }
  }

  if (candidates.length === 0) return null;

  // 日付が最も新しいものを選択（URL内の数値で比較）
  candidates.sort((a, b) => {
    const numA = (a.match(/\d{8}/) || ['0'])[0];
    const numB = (b.match(/\d{8}/) || ['0'])[0];
    return numB.localeCompare(numA);
  });

  return candidates[0];
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

  // 重複カテゴリを除去（最初に見つかったものを優先）
  const seen = new Set<string>();
  return results.filter((f) => {
    if (seen.has(f.category)) return false;
    seen.add(f.category);
    return true;
  });
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

  const validated = await validateExternalHttpsUrl(portalUrl);
  if (!validated.ok) {
    throw new Error(`ポータル URL の検証に失敗: ${validated.reason}`);
  }

  const pinnedAgent = createPinnedDnsAgent(
    validated.hostname ?? new URL(portalUrl).hostname,
    validated.resolvedAddresses,
  );
  const dispatcher = pinnedAgent as unknown as FetchDispatcher;

  try {
    // Step 1: 親ポータルを取得
    logger.info('MHLW index scraper: fetching portal page', { url: portalUrl });
    const portalHtml = await fetchHtml(portalUrl, dispatcher);

    // Step 2: 最新インデックスページ URL を発見
    const indexUrl = extractLatestIndexUrl(portalHtml, portalUrl);
    if (!indexUrl) {
      throw new Error('ポータルページから薬価基準インデックスページのリンクが見つかりません');
    }

    logger.info('MHLW index scraper: found index page', { indexUrl });

    // Step 3: インデックスページを取得（HTTPS + DNS pinning を再検証、同一ホストならエージェント再利用）
    const indexValidated = await validateExternalHttpsUrl(indexUrl);
    if (!indexValidated.ok) {
      throw new Error(`インデックスページ URL の検証に失敗: ${indexValidated.reason}`);
    }
    const portalHostname = validated.hostname ?? new URL(portalUrl).hostname;
    const indexHostname = indexValidated.hostname ?? new URL(indexUrl).hostname;
    const sameHost = portalHostname === indexHostname;
    const indexPinnedAgent = sameHost
      ? null
      : createPinnedDnsAgent(indexHostname, indexValidated.resolvedAddresses);
    const indexDispatcher = sameHost ? dispatcher : indexPinnedAgent as unknown as FetchDispatcher;

    try {
      const indexHtml = await fetchHtml(indexUrl, indexDispatcher);

      // Step 4: Excel URL を抽出
      const files = extractExcelUrls(indexHtml, indexUrl);

      logger.info('MHLW index scraper: discovered files', {
        indexUrl,
        fileCount: files.length,
        categories: files.map((f) => f.category),
      });

      return { indexUrl, files };
    } finally {
      if (indexPinnedAgent) await indexPinnedAgent.close().catch(() => undefined);
    }
  } finally {
    await pinnedAgent.close().catch(() => undefined);
  }
}
