import { describe, expect, it } from 'vitest';
import { extractLatestIndexUrl, extractExcelUrls } from '../services/mhlw-index-scraper';

const PORTAL_BASE = 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000078916.html';

describe('extractLatestIndexUrl', () => {
  it('should extract the latest index page URL from portal HTML', () => {
    const html = `
      <html><body>
        <a href="/topics/2025/04/tp20250401-01_01.html">薬価基準収載品目リスト（令和7年4月）</a>
        <a href="/topics/2024/04/tp20240401-01_01.html">薬価基準収載品目リスト（令和6年4月）</a>
      </body></html>
    `;
    const result = extractLatestIndexUrl(html, PORTAL_BASE);
    expect(result).toBe('https://www.mhlw.go.jp/topics/2025/04/tp20250401-01_01.html');
  });

  it('should return null when no matching links found', () => {
    const html = '<html><body><a href="/other/page.html">unrelated</a></body></html>';
    const result = extractLatestIndexUrl(html, PORTAL_BASE);
    expect(result).toBeNull();
  });

  it('should ignore links to non-MHLW hosts', () => {
    const html = `
      <a href="https://evil.example.com/topics/2025/04/tp20250401-01_01.html">fake</a>
    `;
    const result = extractLatestIndexUrl(html, PORTAL_BASE);
    expect(result).toBeNull();
  });

  it('should handle relative URLs correctly', () => {
    const html = `<a href="/topics/2025/08/tp20250801-01_01.html">test</a>`;
    const result = extractLatestIndexUrl(html, PORTAL_BASE);
    expect(result).toBe('https://www.mhlw.go.jp/topics/2025/08/tp20250801-01_01.html');
  });
});

describe('extractExcelUrls', () => {
  const INDEX_BASE = 'https://www.mhlw.go.jp/topics/2025/04/tp20250401-01_01.html';

  it('should extract 4 category Excel files', () => {
    const html = `
      <html><body>
        <a href="dl/tp20250401-01_01.xlsx">内用薬一覧</a>
        <a href="dl/tp20250401-01_02.xlsx">外用薬一覧</a>
        <a href="dl/tp20250401-01_03.xlsx">注射薬一覧</a>
        <a href="dl/tp20250401-01_04.xlsx">歯科用薬剤一覧</a>
      </body></html>
    `;
    const files = extractExcelUrls(html, INDEX_BASE);
    expect(files).toHaveLength(4);
    expect(files.map((f) => f.category).sort()).toEqual(['内用薬', '外用薬', '歯科用薬剤', '注射薬']);
    expect(files[0].url).toContain('https://www.mhlw.go.jp/topics/2025/04/dl/');
  });

  it('should infer category from link text', () => {
    const html = `
      <a href="file.xlsx">内用薬データ</a>
      <a href="file2.xlsx">外用薬データ</a>
    `;
    const files = extractExcelUrls(html, INDEX_BASE);
    expect(files).toHaveLength(2);
    expect(files[0].category).toBe('内用薬');
    expect(files[1].category).toBe('外用薬');
  });

  it('should infer category from filename suffix pattern', () => {
    const html = `
      <a href="dl/data_01.xlsx">一覧 その1</a>
      <a href="dl/data_02.xlsx">一覧 その2</a>
      <a href="dl/data_03.xlsx">一覧 その3</a>
      <a href="dl/data_04.xlsx">一覧 その4</a>
    `;
    const files = extractExcelUrls(html, INDEX_BASE);
    expect(files).toHaveLength(4);
    expect(files[0].category).toBe('内用薬');
    expect(files[1].category).toBe('外用薬');
    expect(files[2].category).toBe('注射薬');
    expect(files[3].category).toBe('歯科用薬剤');
  });

  it('should deduplicate categories', () => {
    const html = `
      <a href="a.xlsx">内用薬リスト</a>
      <a href="b.xlsx">内用薬追加</a>
    `;
    const files = extractExcelUrls(html, INDEX_BASE);
    expect(files).toHaveLength(1);
    expect(files[0].category).toBe('内用薬');
  });

  it('should skip non-MHLW host links', () => {
    const html = `
      <a href="https://evil.example.com/drug_01.xlsx">内用薬</a>
    `;
    const files = extractExcelUrls(html, INDEX_BASE);
    expect(files).toHaveLength(0);
  });

  it('should skip files without a recognizable category', () => {
    const html = `<a href="unknown_file.xlsx">なんかのデータ</a>`;
    const files = extractExcelUrls(html, INDEX_BASE);
    expect(files).toHaveLength(0);
  });
});
