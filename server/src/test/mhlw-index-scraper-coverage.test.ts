import { describe, expect, it } from 'vitest';
import {
  extractLatestIndexUrl,
  extractExcelUrls,
  DRUG_CATEGORIES,
  type DiscoveredFile,
} from '../services/mhlw-index-scraper';

const PORTAL_BASE = 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000078916.html';
const INDEX_BASE = 'https://www.mhlw.go.jp/topics/2025/04/tp20250401-01_01.html';

describe('mhlw-index-scraper (coverage)', () => {
  // ────────────────────────────────────────────────────
  // DRUG_CATEGORIES constant
  // ────────────────────────────────────────────────────
  describe('DRUG_CATEGORIES', () => {
    it('should contain exactly 4 categories', () => {
      expect(DRUG_CATEGORIES).toHaveLength(4);
    });

    it('should include all expected categories', () => {
      expect(DRUG_CATEGORIES).toContain('内用薬');
      expect(DRUG_CATEGORIES).toContain('外用薬');
      expect(DRUG_CATEGORIES).toContain('注射薬');
      expect(DRUG_CATEGORIES).toContain('歯科用薬剤');
    });
  });

  // ────────────────────────────────────────────────────
  // extractLatestIndexUrl
  // ────────────────────────────────────────────────────
  describe('extractLatestIndexUrl', () => {
    it('should sort by date and return the latest URL', () => {
      const html = `
        <a href="/topics/2024/04/tp20240401-01_01.html">旧</a>
        <a href="/topics/2025/08/tp20250801-01_01.html">新</a>
        <a href="/topics/2025/04/tp20250401-01_01.html">中間</a>
      `;
      const result = extractLatestIndexUrl(html, PORTAL_BASE);
      expect(result).toBe('https://www.mhlw.go.jp/topics/2025/08/tp20250801-01_01.html');
    });

    it('should use broad fallback pattern for yakka-related links', () => {
      const html = `
        <a href="/stf/topics/yakka_index.html">薬価基準データ</a>
      `;
      const result = extractLatestIndexUrl(html, PORTAL_BASE);
      expect(result).toBe('https://www.mhlw.go.jp/stf/topics/yakka_index.html');
    });

    it('should use broad fallback pattern for 薬価 keyword in URL', () => {
      const html = `
        <a href="/stf/topics/薬価一覧.html">薬価一覧リスト</a>
      `;
      const result = extractLatestIndexUrl(html, PORTAL_BASE);
      expect(result).toBe('https://www.mhlw.go.jp/stf/topics/%E8%96%AC%E4%BE%A1%E4%B8%80%E8%A6%A7.html');
    });

    it('should return null when HTML is empty', () => {
      const result = extractLatestIndexUrl('', PORTAL_BASE);
      expect(result).toBeNull();
    });

    it('should return null when only non-MHLW links exist in broad fallback', () => {
      const html = `
        <a href="https://evil.example.com/yakka_test.html">evil</a>
      `;
      const result = extractLatestIndexUrl(html, PORTAL_BASE);
      expect(result).toBeNull();
    });

    it('should handle multiple topics links with same date prefix', () => {
      const html = `
        <a href="/topics/2025/04/tp20250401-01_01.html">A</a>
        <a href="/topics/2025/04/tp20250401-01_02.html">B</a>
      `;
      const result = extractLatestIndexUrl(html, PORTAL_BASE);
      expect(result).not.toBeNull();
      expect(result).toContain('tp20250401-01');
    });

    it('should handle single-quoted href', () => {
      const html = `
        <a href='/topics/2025/04/tp20250401-01_01.html'>single-quoted</a>
      `;
      const result = extractLatestIndexUrl(html, PORTAL_BASE);
      expect(result).toBe('https://www.mhlw.go.jp/topics/2025/04/tp20250401-01_01.html');
    });

    it('should handle URLs without 8-digit date in sort comparison', () => {
      const html = `
        <a href="/topics/2025/04/tp20250401-01_01.html">date</a>
        <a href="/topics/2025/04/tp-01_01.html">no-date</a>
      `;
      const result = extractLatestIndexUrl(html, PORTAL_BASE);
      // The one with a date should sort higher
      expect(result).toContain('tp20250401');
    });

    it('should ignore invalid relative URLs', () => {
      // resolveRelativeUrl with invalid base produces empty string
      const html = `
        <a href="/topics/2025/04/tp20250401-01_01.html">valid</a>
      `;
      const result = extractLatestIndexUrl(html, PORTAL_BASE);
      expect(result).not.toBeNull();
    });
  });

  // ────────────────────────────────────────────────────
  // extractExcelUrls
  // ────────────────────────────────────────────────────
  describe('extractExcelUrls', () => {
    it('should extract .xls files (not just .xlsx)', () => {
      const html = `
        <a href="dl/data_01.xls">内用薬リスト</a>
        <a href="dl/data_02.xls">外用薬リスト</a>
      `;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(2);
      expect(files[0].url).toContain('.xls');
      expect(files[1].url).toContain('.xls');
    });

    it('should infer category from 歯科 keyword in link text', () => {
      const html = `<a href="dental.xlsx">歯科データ一覧</a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(1);
      expect(files[0].category).toBe('歯科用薬剤');
    });

    it('should infer category from 歯科用薬剤 keyword in link text', () => {
      const html = `<a href="dental2.xlsx">歯科用薬剤一覧表</a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(1);
      expect(files[0].category).toBe('歯科用薬剤');
    });

    it('should prefer label inference over filename inference', () => {
      // Link text says 外用薬 but filename says _01 (内用薬)
      const html = `<a href="dl/data_01.xlsx">外用薬データ</a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(1);
      expect(files[0].category).toBe('外用薬');
    });

    it('should fall back to filename inference when label has no category', () => {
      const html = `
        <a href="dl/data_03.xlsx">一覧データ</a>
      `;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(1);
      expect(files[0].category).toBe('注射薬');
    });

    it('should skip files where neither label nor filename has a category', () => {
      const html = `<a href="dl/random_file.xlsx">不明データ</a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(0);
    });

    it('should handle empty HTML', () => {
      const files = extractExcelUrls('', INDEX_BASE);
      expect(files).toHaveLength(0);
    });

    it('should strip inner HTML tags from link text', () => {
      const html = `<a href="dl/data_01.xlsx"><span class="bold">内用薬</span>リスト</a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(1);
      expect(files[0].label).toBe('内用薬リスト');
    });

    it('should use category name as label when link text is empty', () => {
      const html = `<a href="dl/data_01.xlsx"></a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(1);
      expect(files[0].label).toBe('内用薬');
    });

    it('should skip links with non-MHLW absolute URLs', () => {
      const html = `<a href="https://other-site.com/data_01.xlsx">内用薬</a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(0);
    });

    it('should deduplicate keeping only first occurrence per category', () => {
      const html = `
        <a href="dl/a.xlsx">内用薬 第1版</a>
        <a href="dl/b.xlsx">内用薬 第2版</a>
        <a href="dl/c.xlsx">外用薬データ</a>
      `;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(2);
      const categories = files.map((f) => f.category);
      expect(categories).toContain('内用薬');
      expect(categories).toContain('外用薬');
      // First 内用薬 should be kept
      const naiyo = files.find((f) => f.category === '内用薬');
      expect(naiyo?.url).toContain('dl/a.xlsx');
    });

    it('should handle filename suffix _04 with period separator', () => {
      const html = `<a href="dl/tp20250401_04.xlsx">一覧</a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(1);
      expect(files[0].category).toBe('歯科用薬剤');
    });

    it('should handle filename suffix _02 with period separator', () => {
      const html = `<a href="dl/tp20250401_02.xlsx">一覧</a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(1);
      expect(files[0].category).toBe('外用薬');
    });

    it('should handle filename ending with _01.xls', () => {
      const html = `<a href="dl/tp20250401_01.xls">リスト</a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(1);
      expect(files[0].category).toBe('内用薬');
    });

    it('should handle filename ending with _03.xls', () => {
      const html = `<a href="dl/tp20250401_03.xls">リスト</a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(1);
      expect(files[0].category).toBe('注射薬');
    });

    it('should handle filename ending with _04.xls', () => {
      const html = `<a href="dl/tp20250401_04.xls">リスト</a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(1);
      expect(files[0].category).toBe('歯科用薬剤');
    });

    it('should handle filename ending with _02.xls', () => {
      const html = `<a href="dl/tp20250401_02.xls">リスト</a>`;
      const files = extractExcelUrls(html, INDEX_BASE);
      expect(files).toHaveLength(1);
      expect(files[0].category).toBe('外用薬');
    });
  });
});
