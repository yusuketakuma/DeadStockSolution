/**
 * mhlw-index-scraper-deep.test.ts
 * mhlw-index-scraper.ts の未カバーブランチを追加テスト
 * - extractLatestIndexUrl fallback (yakka/薬価 pattern)
 * - extractLatestIndexUrl sorting by 8-digit date
 * - extractExcelUrls xls extension
 * - inferCategoryFromLabel 歯科 keyword
 * - inferCategoryFromFilename _01/_02/_03/_04 with .xls extension
 * - discoverMhlwExcelUrls full flow with mocked fetch
 * - discoverMhlwExcelUrls invalid host
 * - discoverMhlwExcelUrls validation failures
 * - fetchHtml redirect and non-ok
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
  validateExternalHttpsUrl: vi.fn(),
  createPinnedDnsAgent: vi.fn(),
}));

vi.mock('../utils/http-utils', () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
}));
vi.mock('../utils/network-utils', () => ({
  validateExternalHttpsUrl: mocks.validateExternalHttpsUrl,
  createPinnedDnsAgent: mocks.createPinnedDnsAgent,
}));
vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  extractLatestIndexUrl,
  extractExcelUrls,
  discoverMhlwExcelUrls,
  DRUG_CATEGORIES,
} from '../services/mhlw-index-scraper';

const PORTAL_BASE = 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000078916.html';

describe('mhlw-index-scraper deep coverage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── extractLatestIndexUrl fallback patterns ──

  describe('extractLatestIndexUrl fallback', () => {
    it('falls back to yakka/薬価 keyword links when tp pattern not found', () => {
      const html = `
        <a href="/other/page.html">unrelated</a>
        <a href="/other/yakka_list.html">薬価基準</a>
        <a href="/data/yakka_old.html">古い薬価</a>
      `;
      const result = extractLatestIndexUrl(html, PORTAL_BASE);
      expect(result).toBeTruthy();
      expect(result).toContain('mhlw.go.jp');
    });

    it('falls back to 薬価 in label when tp pattern not found', () => {
      const html = `<a href="/data/薬価一覧.html">薬価情報</a>`;
      const result = extractLatestIndexUrl(html, PORTAL_BASE);
      expect(result).toContain('mhlw.go.jp');
    });

    it('returns null when fallback links are on non-MHLW host', () => {
      const html = `<a href="https://evil.com/yakka.html">薬価</a>`;
      const result = extractLatestIndexUrl(html, PORTAL_BASE);
      expect(result).toBeNull();
    });

    it('sorts candidates by 8-digit date descending', () => {
      const html = `
        <a href="/topics/2024/04/tp20240401-01_01.html">2024</a>
        <a href="/topics/2025/10/tp20251001-01_01.html">2025-10</a>
        <a href="/topics/2025/04/tp20250401-01_01.html">2025-04</a>
      `;
      const result = extractLatestIndexUrl(html, PORTAL_BASE);
      expect(result).toContain('20251001');
    });

    it('handles candidate without 8-digit date gracefully', () => {
      const html = `
        <a href="/topics/2025/04/tp20250401-01_01.html">main</a>
        <a href="/topics/2024/01/tp2024-01_01.html">short</a>
      `;
      const result = extractLatestIndexUrl(html, PORTAL_BASE);
      // Should still pick the longer date
      expect(result).toContain('20250401');
    });
  });

  // ── extractExcelUrls additional branches ──

  describe('extractExcelUrls additional', () => {
    const INDEX_BASE = 'https://www.mhlw.go.jp/topics/2025/04/tp20250401-01_01.html';

    it('recognizes .xls extension (not just .xlsx)', () => {
      const html = `<a href="dl/data_01.xls">内用薬一覧</a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(1);
      expect(files[0].url).toContain('.xls');
      expect(files[0].category).toBe('内用薬');
    });

    it('infers 歯科 category from label containing 歯科', () => {
      const html = `<a href="dl/dental.xlsx">歯科関連薬剤</a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(1);
      expect(files[0].category).toBe('歯科用薬剤');
    });

    it('infers category from filename suffix _01.xls, _02.xls, _03.xls, _04.xls', () => {
      const html = `
        <a href="dl/file_01.xls">list 1</a>
        <a href="dl/file_02.xls">list 2</a>
        <a href="dl/file_03.xls">list 3</a>
        <a href="dl/file_04.xls">list 4</a>
      `;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(4);
      expect(files.map((f) => f.category).sort()).toEqual([...DRUG_CATEGORIES].sort());
    });

    it('strips HTML tags from link text', () => {
      const html = `<a href="dl/data_01.xlsx"><span>内用薬</span> <b>一覧</b></a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(1);
      expect(files[0].label).toBe('内用薬 一覧');
    });

    it('uses category as label when link text is empty', () => {
      const html = `<a href="dl/data_02.xlsx"> </a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(1);
      expect(files[0].label).toBe('外用薬');
    });

    it('ignores resolved URLs that fail validation (empty resolve)', () => {
      // test with a relative URL that can be resolved, but host doesn't match
      const html = `<a href="https://other.host/data.xlsx">データ</a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(0);
    });
  });

  // ── discoverMhlwExcelUrls ──

  describe('discoverMhlwExcelUrls', () => {
    it('throws for non-mhlw host', async () => {
      await expect(discoverMhlwExcelUrls('https://evil.com/page'))
        .rejects.toThrow('mhlw.go.jp');
    });

    it('throws when URL validation fails', async () => {
      mocks.validateExternalHttpsUrl.mockResolvedValueOnce({
        ok: false,
        reason: 'プライベートIPです',
        hostname: 'www.mhlw.go.jp',
        resolvedAddresses: [],
      });
      await expect(discoverMhlwExcelUrls('https://www.mhlw.go.jp/page.html'))
        .rejects.toThrow('検証に失敗');
    });

    it('throws when no index page found in portal', async () => {
      const agent = { close: vi.fn(async () => undefined) };
      mocks.validateExternalHttpsUrl.mockResolvedValueOnce({
        ok: true,
        reason: null,
        hostname: 'www.mhlw.go.jp',
        resolvedAddresses: ['1.2.3.4'],
      });
      mocks.createPinnedDnsAgent.mockReturnValueOnce(agent);
      mocks.fetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '<html><body>nothing here</body></html>',
      });

      await expect(discoverMhlwExcelUrls('https://www.mhlw.go.jp/stf/page.html'))
        .rejects.toThrow('インデックスページのリンクが見つかりません');
      expect(agent.close).toHaveBeenCalled();
    });

    it('throws when fetchHtml gets redirect', async () => {
      const agent = { close: vi.fn(async () => undefined) };
      mocks.validateExternalHttpsUrl.mockResolvedValueOnce({
        ok: true,
        reason: null,
        hostname: 'www.mhlw.go.jp',
        resolvedAddresses: ['1.2.3.4'],
      });
      mocks.createPinnedDnsAgent.mockReturnValueOnce(agent);
      mocks.fetchWithTimeout.mockResolvedValueOnce({
        ok: false,
        status: 302,
        statusText: 'Found',
        text: async () => '',
      });

      await expect(discoverMhlwExcelUrls('https://www.mhlw.go.jp/stf/page.html'))
        .rejects.toThrow('Redirect');
    });

    it('throws when fetchHtml gets non-ok response', async () => {
      const agent = { close: vi.fn(async () => undefined) };
      mocks.validateExternalHttpsUrl.mockResolvedValueOnce({
        ok: true,
        reason: null,
        hostname: 'www.mhlw.go.jp',
        resolvedAddresses: ['1.2.3.4'],
      });
      mocks.createPinnedDnsAgent.mockReturnValueOnce(agent);
      mocks.fetchWithTimeout.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: async () => '',
      });

      await expect(discoverMhlwExcelUrls('https://www.mhlw.go.jp/stf/page.html'))
        .rejects.toThrow('500');
    });

    it('completes full scrape flow with same host for index page', async () => {
      const agent = { close: vi.fn(async () => undefined) };
      mocks.validateExternalHttpsUrl
        .mockResolvedValueOnce({
          ok: true,
          reason: null,
          hostname: 'www.mhlw.go.jp',
          resolvedAddresses: ['1.2.3.4'],
        })
        .mockResolvedValueOnce({
          ok: true,
          reason: null,
          hostname: 'www.mhlw.go.jp',
          resolvedAddresses: ['1.2.3.4'],
        });
      mocks.createPinnedDnsAgent.mockReturnValueOnce(agent);

      const portalHtml = `<a href="/topics/2025/04/tp20250401-01_01.html">薬価基準</a>`;
      const indexHtml = `
        <a href="dl/data_01.xlsx">内用薬</a>
        <a href="dl/data_02.xlsx">外用薬</a>
        <a href="dl/data_03.xlsx">注射薬</a>
        <a href="dl/data_04.xlsx">歯科用薬剤</a>
      `;
      mocks.fetchWithTimeout
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => portalHtml })
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => indexHtml });

      const result = await discoverMhlwExcelUrls('https://www.mhlw.go.jp/stf/page.html');
      expect(result.indexUrl).toContain('tp20250401');
      expect(result.files).toHaveLength(4);
      expect(agent.close).toHaveBeenCalled();
    });

    it('creates separate agent for index page on different host', async () => {
      const portalAgent = { close: vi.fn(async () => undefined) };
      const indexAgent = { close: vi.fn(async () => undefined) };

      mocks.validateExternalHttpsUrl
        .mockResolvedValueOnce({
          ok: true,
          reason: null,
          hostname: 'www.mhlw.go.jp',
          resolvedAddresses: ['1.2.3.4'],
        })
        .mockResolvedValueOnce({
          ok: true,
          reason: null,
          hostname: 'topics.mhlw.go.jp',
          resolvedAddresses: ['5.6.7.8'],
        });
      mocks.createPinnedDnsAgent
        .mockReturnValueOnce(portalAgent)
        .mockReturnValueOnce(indexAgent);

      const portalHtml = `<a href="https://topics.mhlw.go.jp/topics/2025/04/tp20250401-01_01.html">薬価</a>`;
      const indexHtml = `<a href="dl/data_01.xlsx">内用薬</a>`;

      mocks.fetchWithTimeout
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => portalHtml })
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => indexHtml });

      const result = await discoverMhlwExcelUrls('https://www.mhlw.go.jp/stf/page.html');
      expect(result.files).toHaveLength(1);
      expect(portalAgent.close).toHaveBeenCalled();
      expect(indexAgent.close).toHaveBeenCalled();
    });

    it('throws when index page validation fails', async () => {
      const agent = { close: vi.fn(async () => undefined) };
      mocks.validateExternalHttpsUrl
        .mockResolvedValueOnce({
          ok: true,
          reason: null,
          hostname: 'www.mhlw.go.jp',
          resolvedAddresses: ['1.2.3.4'],
        })
        .mockResolvedValueOnce({
          ok: false,
          reason: 'プライベートIP',
          hostname: 'www.mhlw.go.jp',
          resolvedAddresses: [],
        });
      mocks.createPinnedDnsAgent.mockReturnValueOnce(agent);

      const portalHtml = `<a href="/topics/2025/04/tp20250401-01_01.html">薬価</a>`;
      mocks.fetchWithTimeout.mockResolvedValueOnce({ ok: true, status: 200, text: async () => portalHtml });

      await expect(discoverMhlwExcelUrls('https://www.mhlw.go.jp/stf/page.html'))
        .rejects.toThrow('インデックスページ URL の検証に失敗');
    });
  });
});
