import AdmZip from 'adm-zip';
import { describe, it, expect } from 'vitest';
import { parseMhlwExcelData, parsePackageExcelData, parsePackageXmlData, parsePackageZipData } from '../services/drug-master-service';

describe('drug-master parser', () => {
  it('keeps column index 0 headers mapped correctly for mhlw sheet', () => {
    const rows: unknown[][] = [
      ['区分', '薬価基準収載医薬品コード', '成分名', '規格', '', '', '', '品名', 'メーカー名', '', '先発医薬品', '', '薬価'],
      ['内用薬', '1121001X1018', 'ブロモバレリル尿素', '1g', '', '', '', 'ブロモバレリル尿素', 'メーカーA', '', '先発品', '', '7.5'],
    ];

    const parsed = parseMhlwExcelData(rows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].yjCode).toBe('1121001X1018');
    expect(parsed[0].yakkaPrice).toBe(7.5);
    expect(parsed[0].category).toBe('内用薬');
  });

  it('parses package rows when header starts at first column', () => {
    const rows: unknown[][] = [
      ['YJコード', 'GS1コード', '包装', '包装数量', '単位'],
      ['1121001X1018', '14987123456789', '100錠バラ包装', '100', '錠'],
    ];

    const parsed = parsePackageExcelData(rows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].yjCode).toBe('1121001X1018');
    expect(parsed[0].gs1Code).toBe('14987123456789');
    expect(parsed[0].packageDescription).toBe('100錠バラ包装');
    expect(parsed[0].packageQuantity).toBe(100);
    expect(parsed[0].packageUnit).toBe('錠');
  });

  it('parses package rows from xml payload', () => {
    const xml = `
      <items>
        <item>
          <薬価基準収載医薬品コード>1121001X1018</薬価基準収載医薬品コード>
          <販売包装単位コード>14987123456789</販売包装単位コード>
          <JANコード>4987123456789</JANコード>
          <HOTコード>123456789</HOTコード>
          <包装単位>100錠バラ包装</包装単位>
          <包装数量>100</包装数量>
          <単位>錠</単位>
        </item>
      </items>
    `;

    const parsed = parsePackageXmlData(xml);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].yjCode).toBe('1121001X1018');
    expect(parsed[0].gs1Code).toBe('14987123456789');
    expect(parsed[0].janCode).toBe('4987123456789');
    expect(parsed[0].hotCode).toBe('123456789');
    expect(parsed[0].packageDescription).toBe('100錠バラ包装');
    expect(parsed[0].packageQuantity).toBe(100);
    expect(parsed[0].packageUnit).toBe('錠');
  });

  it('parses package rows from zip payload', async () => {
    const zip = new AdmZip();
    zip.addFile('package.xml', Buffer.from(`
      <items>
        <item>
          <薬価基準収載医薬品コード>1121001X1018</薬価基準収載医薬品コード>
          <販売包装単位コード>14987123456789</販売包装単位コード>
          <包装単位>100錠バラ包装</包装単位>
        </item>
      </items>
    `, 'utf-8'));

    const parsed = await parsePackageZipData(zip.toBuffer());
    expect(parsed).toHaveLength(1);
    expect(parsed[0].yjCode).toBe('1121001X1018');
    expect(parsed[0].gs1Code).toBe('14987123456789');
    expect(parsed[0].packageDescription).toBe('100錠バラ包装');
  });
});
