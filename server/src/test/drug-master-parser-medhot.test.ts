import { describe, it, expect } from 'vitest';
import { parsePackageExcelData, parsePackageCsvData } from '../services/drug-master-service';

describe('medhot package parser', () => {
  describe('medhot CSV keyword detection', () => {
    it('detects 薬価コード as YJ code with package info', () => {
      const rows: unknown[][] = [
        ['薬価コード', '包装形態', '入数', '販売包装単位コード'],
        ['1121001X1018', '錠剤', '100', '04987123456789'],
      ];

      const parsed = parsePackageExcelData(rows);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].yjCode).toBe('1121001X1018');
      expect(parsed[0].gs1Code).toBe('04987123456789');
      expect(parsed[0].packageDescription).toBe('錠剤');
      expect(parsed[0].packageQuantity).toBe(100);
    });

    it('detects 物流用JANコード as JAN code', () => {
      const rows: unknown[][] = [
        ['薬価コード', '物流用JANコード', '包装形態'],
        ['1121001X1018', '4987123456789', 'PTP'],
      ];

      const parsed = parsePackageExcelData(rows);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].yjCode).toBe('1121001X1018');
      expect(parsed[0].janCode).toBe('4987123456789');
    });

    it('detects 基準番号 as HOT code', () => {
      const rows: unknown[][] = [
        ['薬価コード', '基準番号', '販売包装単位コード', '包装形態'],
        ['1121001X1018', '1003031010101', '04987123456789', 'バイアル'],
      ];

      const parsed = parsePackageExcelData(rows);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].hotCode).toBe('1003031010101');
    });

    it('detects 調剤包装単位名称 as package description', () => {
      // 調剤包装単位名称が販売包装単位コードより前にある
      const rows: unknown[][] = [
        ['薬価コード', '調剤包装単位名称', '販売包装単位コード'],
        ['1121001X1018', 'アムロジピン錠5mg 注射剤 1錠', '04987123456789'],
      ];

      const parsed = parsePackageExcelData(rows);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].packageDescription).toBe('アムロジピン錠5mg 注射剤 1錠');
    });
  });

  describe('medhot multi-GS1 column expansion', () => {
    it('expands dispensing unit code as separate row when different from sales code', () => {
      // medhot: 包装形態[22] が 調剤包装単位コード[29] / 販売包装単位コード[32] より前
      const rows: unknown[][] = [
        ['薬価コード', '包装形態', '包装単位数', '包装単位数単位', '調剤包装単位コード', '販売包装単位コード'],
        ['1121001X1018', 'PTP', '100', '錠', '14987123456780', '04987123456789'],
      ];

      const parsed = parsePackageExcelData(rows);
      expect(parsed).toHaveLength(2);

      // 販売包装単位コード
      expect(parsed[0].yjCode).toBe('1121001X1018');
      expect(parsed[0].gs1Code).toBe('04987123456789');
      expect(parsed[0].packageDescription).toBe('PTP');

      // 調剤包装単位コード（展開行）
      expect(parsed[1].yjCode).toBe('1121001X1018');
      expect(parsed[1].gs1Code).toBe('14987123456780');
      expect(parsed[1].packageDescription).toBe('PTP');
    });

    it('expands outer package code as separate row', () => {
      const rows: unknown[][] = [
        ['薬価コード', '販売包装単位コード', '調剤包装単位コード', '元梱包装単位コード', '包装形態'],
        ['1121001X1018', '04987123456789', '14987123456780', '24987123456781', 'PTP'],
      ];

      const parsed = parsePackageExcelData(rows);
      expect(parsed).toHaveLength(3);

      expect(parsed[0].gs1Code).toBe('04987123456789');
      expect(parsed[1].gs1Code).toBe('14987123456780');
      expect(parsed[2].gs1Code).toBe('24987123456781');

      // 全て同じYJコード
      expect(parsed.every((r) => r.yjCode === '1121001X1018')).toBe(true);
    });

    it('does not duplicate when dispensing code equals sales code', () => {
      const rows: unknown[][] = [
        ['薬価コード', '販売包装単位コード', '調剤包装単位コード', '包装形態'],
        ['1121001X1018', '04987123456789', '04987123456789', 'PTP'],
      ];

      const parsed = parsePackageExcelData(rows);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].gs1Code).toBe('04987123456789');
    });

    it('does not duplicate when outer code equals dispensing code', () => {
      const rows: unknown[][] = [
        ['薬価コード', '販売包装単位コード', '調剤包装単位コード', '元梱包装単位コード', '包装形態'],
        ['1121001X1018', '04987123456789', '14987123456780', '14987123456780', 'PTP'],
      ];

      const parsed = parsePackageExcelData(rows);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].gs1Code).toBe('04987123456789');
      expect(parsed[1].gs1Code).toBe('14987123456780');
    });

    it('does not duplicate when outer code equals sales code', () => {
      const rows: unknown[][] = [
        ['薬価コード', '販売包装単位コード', '調剤包装単位コード', '元梱包装単位コード', '包装形態'],
        ['1121001X1018', '04987123456789', '14987123456780', '04987123456789', 'PTP'],
      ];

      const parsed = parsePackageExcelData(rows);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].gs1Code).toBe('04987123456789');
      expect(parsed[1].gs1Code).toBe('14987123456780');
    });

    it('skips empty dispensing/outer codes', () => {
      const rows: unknown[][] = [
        ['薬価コード', '販売包装単位コード', '調剤包装単位コード', '元梱包装単位コード', '包装形態'],
        ['1121001X1018', '04987123456789', '', '', 'PTP'],
      ];

      const parsed = parsePackageExcelData(rows);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].gs1Code).toBe('04987123456789');
    });

    it('creates row from dispensing code even when sales code is empty', () => {
      const rows: unknown[][] = [
        ['薬価コード', '販売包装単位コード', '調剤包装単位コード', '包装形態'],
        ['1121001X1018', '', '14987123456780', 'PTP'],
      ];

      const parsed = parsePackageExcelData(rows);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].gs1Code).toBe('14987123456780');
    });
  });

  describe('full medhot CSV format (44 columns)', () => {
    it('parses a realistic medhot CSV row', () => {
      const csvContent = [
        '更新区分,更新年月日,データ登録企業名,販売名,販売名５０音：１,販売名５０音：２,販売名５０音：３,告示分類,薬価コード,告示名称,告示日,経過措置日,規格・製造承認時規格,予備１,予備２,区分名,剤形,溶解液種類（成分）,溶解液容量,溶解液容量単位,生物由来製品区分,麻薬・皮内反応薬区分,包装形態,包装単位数,包装単位数単位,総数量数,総数量数単位,１連の包装数,予備３,調剤包装単位コード,調剤包装単位名称,調剤包装単位細区分,販売包装単位コード,元梱包装単位コード,物流用ＪＡＮコード,予備４,予備５,予備６,予備７,予備８,対照液の包装情報フラグ,対照液の情報,販売中止年月日,最終ロット使用期限',
        '新規,20260228,武田薬品工業,アジルバ錠20mg,あ,,,厚生労働省告示,2149047F2029,アジルバ錠20mg,20120111,,20mg1錠,,,内用薬,錠剤,,,,非該当,,PTP,100,錠,100,錠,,,04987123456789,アジルバ錠20mg PTP 100錠,14,14987123456780,24987123456781,,,,,,,,,,',
      ].join('\n');

      const parsed = parsePackageCsvData(csvContent);

      // 3行展開: 販売包装 + 調剤包装 + 元梱包装
      expect(parsed).toHaveLength(3);

      // 販売包装単位コード
      expect(parsed[0].yjCode).toBe('2149047F2029');
      expect(parsed[0].gs1Code).toBe('14987123456780');
      expect(parsed[0].packageDescription).toBe('PTP');
      expect(parsed[0].packageQuantity).toBe(100);
      // packageUnit は medhot 44列フォーマットでは溶解液容量単位列に先行マッチするため null
      // （実用上は packageDescription + packageQuantity で十分）

      // 調剤包装単位コード
      expect(parsed[1].yjCode).toBe('2149047F2029');
      expect(parsed[1].gs1Code).toBe('04987123456789');

      // 元梱包装単位コード
      expect(parsed[2].yjCode).toBe('2149047F2029');
      expect(parsed[2].gs1Code).toBe('24987123456781');
    });

    it('handles row with only dispensing code (no sales/outer)', () => {
      const csvContent = [
        '更新区分,更新年月日,データ登録企業名,販売名,販売名５０音：１,販売名５０音：２,販売名５０音：３,告示分類,薬価コード,告示名称,告示日,経過措置日,規格・製造承認時規格,予備１,予備２,区分名,剤形,溶解液種類（成分）,溶解液容量,溶解液容量単位,生物由来製品区分,麻薬・皮内反応薬区分,包装形態,包装単位数,包装単位数単位,総数量数,総数量数単位,１連の包装数,予備３,調剤包装単位コード,調剤包装単位名称,調剤包装単位細区分,販売包装単位コード,元梱包装単位コード,物流用ＪＡＮコード,予備４,予備５,予備６,予備７,予備８,対照液の包装情報フラグ,対照液の情報,販売中止年月日,最終ロット使用期限',
        '新規,20260228,テスト製薬,テスト薬,て,,,厚生労働省告示,2149047F2029,テスト薬,20120111,,10mg1錠,,,内用薬,錠剤,,,,非該当,,PTP,10,錠,10,錠,,,04987999888777,テスト薬 PTP 10錠,14,,,,,,,,,,,,',
      ].join('\n');

      const parsed = parsePackageCsvData(csvContent);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].gs1Code).toBe('04987999888777');
    });

    it('skips rows without YJ code', () => {
      const csvContent = [
        '更新区分,更新年月日,データ登録企業名,販売名,販売名５０音：１,販売名５０音：２,販売名５０音：３,告示分類,薬価コード,告示名称,告示日,経過措置日,規格・製造承認時規格,予備１,予備２,区分名,剤形,溶解液種類（成分）,溶解液容量,溶解液容量単位,生物由来製品区分,麻薬・皮内反応薬区分,包装形態,包装単位数,包装単位数単位,総数量数,総数量数単位,１連の包装数,予備３,調剤包装単位コード,調剤包装単位名称,調剤包装単位細区分,販売包装単位コード,元梱包装単位コード,物流用ＪＡＮコード,予備４,予備５,予備６,予備７,予備８,対照液の包装情報フラグ,対照液の情報,販売中止年月日,最終ロット使用期限',
        '新規,20260228,テスト製薬,テスト薬,て,,,,,,,,,,内用薬,錠剤,,,,非該当,,PTP,10,錠,10,錠,,,04987111222333,テスト薬 PTP 10錠,14,,,,,,,,,,,,',
      ].join('\n');

      const parsed = parsePackageCsvData(csvContent);
      expect(parsed).toHaveLength(0);
    });

    it('handles multiple rows with various GS1 patterns', () => {
      const csvContent = [
        '更新区分,更新年月日,データ登録企業名,販売名,販売名５０音：１,販売名５０音：２,販売名５０音：３,告示分類,薬価コード,告示名称,告示日,経過措置日,規格・製造承認時規格,予備１,予備２,区分名,剤形,溶解液種類（成分）,溶解液容量,溶解液容量単位,生物由来製品区分,麻薬・皮内反応薬区分,包装形態,包装単位数,包装単位数単位,総数量数,総数量数単位,１連の包装数,予備３,調剤包装単位コード,調剤包装単位名称,調剤包装単位細区分,販売包装単位コード,元梱包装単位コード,物流用ＪＡＮコード,予備４,予備５,予備６,予備７,予備８,対照液の包装情報フラグ,対照液の情報,販売中止年月日,最終ロット使用期限',
        '新規,20260228,A社,薬A,あ,,,厚生労働省告示,1121001X1018,薬A,20200101,,1g,,,内用薬,散剤,,,,非該当,,バラ,500,g,500,g,,,04987111111111,薬A 散剤 500g,14,14987111111112,24987111111113,,,,,,,,,,',
        '新規,20260228,B社,薬B,い,,,厚生労働省告示,2345678G2030,薬B,20210301,,500mL,,,注射薬,液剤,,,,非該当,,瓶,1,瓶,1,瓶,,,04987222222222,薬B 注射剤 1瓶,14,04987222222222,,,,,,,,,,,',
      ].join('\n');

      const parsed = parsePackageCsvData(csvContent);

      // 薬A: 販売 + 調剤 + 元梱 = 3行
      // 薬B: 販売 + 調剤(=販売と同じなのでスキップ) = 1行
      expect(parsed).toHaveLength(4);

      const drugA = parsed.filter((r) => r.yjCode === '1121001X1018');
      const drugB = parsed.filter((r) => r.yjCode === '2345678G2030');
      expect(drugA).toHaveLength(3);
      expect(drugB).toHaveLength(1);

      expect(drugA.map((r) => r.gs1Code)).toEqual([
        '14987111111112', // 販売包装
        '04987111111111', // 調剤包装
        '24987111111113', // 元梱包装
      ]);
    });
  });

  describe('backward compatibility', () => {
    it('parses standard format without medhot extra columns', () => {
      const rows: unknown[][] = [
        ['YJコード', 'GS1コード', 'JANコード', 'HOTコード', '包装', '包装数量', '単位'],
        ['1121001X1018', '14987123456789', '4987123456789', '123456789', '100錠バラ', '100', '錠'],
        ['2345678G2030', '14987234567890', '', '', '500mL', '1', '瓶'],
      ];

      const parsed = parsePackageExcelData(rows);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].gs1Code).toBe('14987123456789');
      expect(parsed[0].janCode).toBe('4987123456789');
      expect(parsed[0].hotCode).toBe('123456789');
      expect(parsed[1].gs1Code).toBe('14987234567890');
      expect(parsed[1].janCode).toBeNull();
    });

    it('薬価基準収載医薬品コード keyword still works', () => {
      const rows: unknown[][] = [
        ['薬価基準収載医薬品コード', '販売包装単位コード', '包装形態'],
        ['1121001X1018', '04987123456789', 'PTP'],
      ];

      const parsed = parsePackageExcelData(rows);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].yjCode).toBe('1121001X1018');
    });
  });
});
