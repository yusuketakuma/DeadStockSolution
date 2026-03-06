import { describe, it, expect, vi } from 'vitest';
import { parseCameraCode } from '../services/gs1-parser';
import * as drugMasterParserService from '../services/drug-master-parser-service';

describe('gs1-parser', () => {
  describe('parseCameraCode()', () => {
    describe('codeType detection', () => {
      it('returns "gs1" codeType for valid bracketed GS1 code', () => {
        const result = parseCameraCode('(01)14912345678901(17)251231(10)LOT123');
        expect(result.codeType).toBe('gs1');
      });

      it('returns "gs1" codeType for valid unbracketed GS1 code with GS separator', () => {
        const result = parseCameraCode('0114912345678901\u001D17251231\u001D10LOT123');
        expect(result.codeType).toBe('gs1');
      });

      it('returns "gs1" codeType for 14-digit GTIN only', () => {
        const result = parseCameraCode('14912345678901');
        expect(result.codeType).toBe('gs1');
      });

      it('returns "gs1" codeType for 13-digit barcode (prepends 0)', () => {
        const result = parseCameraCode('1491234567890');
        expect(result.codeType).toBe('gs1');
        expect(result.gtin).toBe('01491234567890');
      });

      it('returns "yj" codeType for valid YJ code', () => {
        vi.spyOn(drugMasterParserService, 'parseYjCode').mockReturnValue('112100001018');
        const result = parseCameraCode('112100001018');
        expect(result.codeType).toBe('yj');
        expect(result.yjCode).toBe('112100001018');
        vi.restoreAllMocks();
      });

      it('returns "unknown" codeType for unrecognized code', () => {
        vi.spyOn(drugMasterParserService, 'parseYjCode').mockReturnValue(null);
        const result = parseCameraCode('invalid-code-xyz');
        expect(result.codeType).toBe('unknown');
        vi.restoreAllMocks();
      });
    });

    describe('GS1 parsing - bracketed format', () => {
      it('extracts GTIN (AI01) - 14 digits', () => {
        const result = parseCameraCode('(01)14912345678901(17)251231(10)LOT123');
        expect(result.gtin).toBe('14912345678901');
      });

      it('extracts expiration date (AI17) - YYMMDD to ISO format', () => {
        const result = parseCameraCode('(01)14912345678901(17)251231(10)LOT123');
        expect(result.expirationDate).toBe('2025-12-31');
      });

      it('extracts lot number (AI10) - up to 20 chars', () => {
        const result = parseCameraCode('(01)14912345678901(17)251231(10)LOT123');
        expect(result.lotNumber).toBe('LOT123');
      });

      it('extracts lot number with maximum 20 characters', () => {
        const longLot = 'A'.repeat(25);
        const result = parseCameraCode(`(01)14912345678901(17)251231(10)${longLot}`);
        expect(result.lotNumber).toBe('A'.repeat(20));
      });

      it('handles bracketed format with GS separator in values', () => {
        const result = parseCameraCode(`(01)14912345678901\u001D(17)251231\u001D(10)LOT123`);
        expect(result.gtin).toBe('14912345678901');
        expect(result.expirationDate).toBe('2025-12-31');
        expect(result.lotNumber).toBe('LOT123');
      });

      it('ignores unknown AIs in bracketed format', () => {
        const result = parseCameraCode('(01)14912345678901(99)UNKNOWN(17)251231(10)LOT123');
        expect(result.gtin).toBe('14912345678901');
        expect(result.expirationDate).toBe('2025-12-31');
        expect(result.lotNumber).toBe('LOT123');
      });

      it('handles bracketed format with invalid GTIN - still parses as GS1 if other fields valid', () => {
        const result = parseCameraCode('(01)1491234567890X(17)251231(10)LOT123');
        expect(result.codeType).toBe('gs1');
        expect(result.gtin).toBeNull();
      });
    });

    describe('GS1 parsing - unbracketed format', () => {
      it('parses unbracketed GS1 format with GS separator', () => {
        const result = parseCameraCode(`0114912345678901\u001D17251231\u001D10LOT123`);
        expect(result.gtin).toBe('14912345678901');
        expect(result.expirationDate).toBe('2025-12-31');
        expect(result.lotNumber).toBe('LOT123');
      });

      it('handles unbracketed format with invalid GTIN - still parses as GS1 if other fields valid', () => {
        const result = parseCameraCode(`0114912345678901X\u001D17251231\u001D10LOT123`);
        expect(result.codeType).toBe('gs1');
        expect(result.gtin).toBe('14912345678901');
      });

      it('returns null for unbracketed format with invalid expiration date', () => {
        const result = parseCameraCode(`0114912345678901\u001D17991331\u001D10LOT123`);
        expect(result.codeType).toBe('unknown');
      });

      it('returns null for unbracketed format with missing lot number', () => {
        const result = parseCameraCode(`0114912345678901\u001D17251231\u001D10`);
        expect(result.codeType).toBe('unknown');
      });
    });

    describe('normalization', () => {
      it('strips symbology prefix (]C1 format)', () => {
        const result = parseCameraCode(']C114912345678901');
        expect(result.normalizedCode).toBe('14912345678901');
        expect(result.gtin).toBe('14912345678901');
      });

      it('removes control characters', () => {
        const result = parseCameraCode('14912345678901\x00\x01\x02');
        expect(result.normalizedCode).toBe('14912345678901');
        expect(result.gtin).toBe('14912345678901');
      });

      it('removes whitespace', () => {
        const result = parseCameraCode('14912345678901   ');
        expect(result.normalizedCode).toBe('14912345678901');
        expect(result.gtin).toBe('14912345678901');
      });

      it('normalizes Unicode (NFKC)', () => {
        const fullWidthCode = '１４９１２３４５６７８９０１';
        const result = parseCameraCode(fullWidthCode);
        expect(result.normalizedCode).toBe('14912345678901');
      });

      it('handles combined normalization', () => {
        const result = parseCameraCode(']C1 14912345678901 \x00\x01');
        expect(result.normalizedCode).toBe('14912345678901');
        expect(result.gtin).toBe('14912345678901');
      });
    });

    describe('warnings', () => {
      it('adds warning for missing expiration date (AI17)', () => {
        const result = parseCameraCode('(01)14912345678901(10)LOT123');
        expect(result.warnings).toContain('使用期限(AI17)はバーコードから取得できませんでした。');
      });

      it('adds warning for missing lot number (AI10)', () => {
        const result = parseCameraCode('(01)14912345678901(17)251231');
        expect(result.warnings).toContain('ロット番号(AI10)はバーコードから取得できませんでした。');
      });

      it('adds both warnings when both fields are missing', () => {
        const result = parseCameraCode('(01)14912345678901');
        expect(result.warnings).toHaveLength(2);
        expect(result.warnings).toContain('使用期限(AI17)はバーコードから取得できませんでした。');
        expect(result.warnings).toContain('ロット番号(AI10)はバーコードから取得できませんでした。');
      });

      it('adds warning for unknown code type', () => {
        vi.spyOn(drugMasterParserService, 'parseYjCode').mockReturnValue(null);
        const result = parseCameraCode('invalid-code');
        expect(result.warnings).toContain('GS1またはYJコードとして認識できませんでした。');
        vi.restoreAllMocks();
      });

      it('does not add warnings for valid GS1 with all fields', () => {
        const result = parseCameraCode('(01)14912345678901(17)251231(10)LOT123');
        expect(result.warnings).toHaveLength(0);
      });

      it('does not add warnings for valid YJ code', () => {
        vi.spyOn(drugMasterParserService, 'parseYjCode').mockReturnValue('112100001018');
        const result = parseCameraCode('112100001018');
        expect(result.warnings).toHaveLength(0);
        vi.restoreAllMocks();
      });
    });

    describe('edge cases', () => {
      it('handles empty string', () => {
        const result = parseCameraCode('');
        expect(result.codeType).toBe('unknown');
        expect(result.normalizedCode).toBe('');
        expect(result.gtin).toBeNull();
        expect(result.yjCode).toBeNull();
      });

      it('handles whitespace-only string', () => {
        const result = parseCameraCode('   \t\n  ');
        expect(result.codeType).toBe('unknown');
        expect(result.normalizedCode).toBe('');
      });

      it('handles invalid expiration date - month 13 - still parses as GS1 with GTIN only', () => {
        const result = parseCameraCode('(01)14912345678901(17)251331(10)LOT123');
        expect(result.codeType).toBe('gs1');
        expect(result.gtin).toBe('14912345678901');
        expect(result.expirationDate).toBeNull();
        expect(result.lotNumber).toBe('LOT123');
      });

      it('handles invalid expiration date - day 32 - still parses as GS1 with GTIN only', () => {
        const result = parseCameraCode('(01)14912345678901(17)251232(10)LOT123');
        expect(result.codeType).toBe('gs1');
        expect(result.gtin).toBe('14912345678901');
        expect(result.expirationDate).toBeNull();
        expect(result.lotNumber).toBe('LOT123');
      });

      it('handles invalid expiration date - day 0 - still parses as GS1 with GTIN only', () => {
        const result = parseCameraCode('(01)14912345678901(17)251200(10)LOT123');
        expect(result.codeType).toBe('gs1');
        expect(result.gtin).toBe('14912345678901');
        expect(result.expirationDate).toBeNull();
        expect(result.lotNumber).toBe('LOT123');
      });

      it('handles invalid expiration date - month 0 - still parses as GS1 with GTIN only', () => {
        const result = parseCameraCode('(01)14912345678901(17)250031(10)LOT123');
        expect(result.codeType).toBe('gs1');
        expect(result.gtin).toBe('14912345678901');
        expect(result.expirationDate).toBeNull();
        expect(result.lotNumber).toBe('LOT123');
      });

      it('handles expiration date with non-numeric characters - still parses as GS1 with GTIN only', () => {
        const result = parseCameraCode('(01)14912345678901(17)25123X(10)LOT123');
        expect(result.codeType).toBe('gs1');
        expect(result.gtin).toBe('14912345678901');
        expect(result.expirationDate).toBeNull();
        expect(result.lotNumber).toBe('LOT123');
      });

      it('handles GTIN with less than 14 digits - still parses as GS1 with GTIN only', () => {
        const result = parseCameraCode('(01)1491234567890(17)251231(10)LOT123');
        expect(result.codeType).toBe('gs1');
        expect(result.gtin).toBeNull();
        expect(result.expirationDate).toBe('2025-12-31');
        expect(result.lotNumber).toBe('LOT123');
      });

      it('handles GTIN with more than 14 digits - extracts first 14 digits', () => {
        const result = parseCameraCode('(01)149123456789012(17)251231(10)LOT123');
        expect(result.codeType).toBe('gs1');
        expect(result.gtin).toBe('14912345678901');
        expect(result.expirationDate).toBe('2025-12-31');
        expect(result.lotNumber).toBe('LOT123');
      });

      it('handles 13-digit barcode correctly', () => {
        const result = parseCameraCode('1491234567890');
        expect(result.codeType).toBe('gs1');
        expect(result.gtin).toBe('01491234567890');
      });

      it('handles 12-digit code as unknown', () => {
        vi.spyOn(drugMasterParserService, 'parseYjCode').mockReturnValue(null);
        const result = parseCameraCode('149123456789');
        expect(result.codeType).toBe('unknown');
        vi.restoreAllMocks();
      });

      it('handles lot number with special characters', () => {
        const result = parseCameraCode('(01)14912345678901(17)251231(10)LOT-123/ABC');
        expect(result.lotNumber).toBe('LOT-123/ABC');
      });

      it('handles lot number with spaces - spaces are removed during normalization', () => {
        const result = parseCameraCode('(01)14912345678901(17)251231(10)LOT 123');
        expect(result.lotNumber).toBe('LOT123');
      });

      it('handles February 29 on leap year', () => {
        const result = parseCameraCode('(01)14912345678901(17)240229(10)LOT123');
        expect(result.expirationDate).toBe('2024-02-29');
      });

      it('handles February 29 on non-leap year - still parses as GS1 with GTIN only', () => {
        const result = parseCameraCode('(01)14912345678901(17)250229(10)LOT123');
        expect(result.codeType).toBe('gs1');
        expect(result.gtin).toBe('14912345678901');
        expect(result.expirationDate).toBeNull();
        expect(result.lotNumber).toBe('LOT123');
      });

      it('handles year 2000 correctly', () => {
        const result = parseCameraCode('(01)14912345678901(17)001231(10)LOT123');
        expect(result.expirationDate).toBe('2000-12-31');
      });

      it('handles year 2099 correctly', () => {
        const result = parseCameraCode('(01)14912345678901(17)991231(10)LOT123');
        expect(result.expirationDate).toBe('2099-12-31');
      });
    });

    describe('return structure', () => {
      it('returns ParsedCameraCode with all required fields', () => {
        const result = parseCameraCode('(01)14912345678901(17)251231(10)LOT123');
        expect(result).toHaveProperty('codeType');
        expect(result).toHaveProperty('normalizedCode');
        expect(result).toHaveProperty('gtin');
        expect(result).toHaveProperty('yjCode');
        expect(result).toHaveProperty('expirationDate');
        expect(result).toHaveProperty('lotNumber');
        expect(result).toHaveProperty('warnings');
      });

      it('returns null values for non-applicable fields in GS1 code', () => {
        const result = parseCameraCode('(01)14912345678901(17)251231(10)LOT123');
        expect(result.yjCode).toBeNull();
      });

      it('returns null values for non-applicable fields in YJ code', () => {
        vi.spyOn(drugMasterParserService, 'parseYjCode').mockReturnValue('112100001018');
        const result = parseCameraCode('112100001018');
        expect(result.gtin).toBeNull();
        expect(result.expirationDate).toBeNull();
        expect(result.lotNumber).toBeNull();
        vi.restoreAllMocks();
      });

      it('returns empty warnings array for valid codes', () => {
        const result = parseCameraCode('(01)14912345678901(17)251231(10)LOT123');
        expect(Array.isArray(result.warnings)).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });
    });

    describe('integration scenarios', () => {
      it('handles real-world GS1 barcode with all fields', () => {
        const result = parseCameraCode('(01)04912345678901(17)251231(10)ABC123DEF456');
        expect(result.codeType).toBe('gs1');
        expect(result.gtin).toBe('04912345678901');
        expect(result.expirationDate).toBe('2025-12-31');
        expect(result.lotNumber).toBe('ABC123DEF456');
        expect(result.warnings).toHaveLength(0);
      });

      it('handles real-world GS1 barcode with only GTIN', () => {
        const result = parseCameraCode('(01)04912345678901');
        expect(result.codeType).toBe('gs1');
        expect(result.gtin).toBe('04912345678901');
        expect(result.expirationDate).toBeNull();
        expect(result.lotNumber).toBeNull();
        expect(result.warnings).toHaveLength(2);
      });

      it('handles real-world 13-digit barcode', () => {
        const result = parseCameraCode('4912345678901');
        expect(result.codeType).toBe('gs1');
        expect(result.gtin).toBe('04912345678901');
        expect(result.expirationDate).toBeNull();
        expect(result.lotNumber).toBeNull();
      });

      it('handles barcode with symbology prefix and normalization', () => {
        const result = parseCameraCode(']C1(01)04912345678901(17)251231(10)LOT123');
        expect(result.codeType).toBe('gs1');
        expect(result.gtin).toBe('04912345678901');
        expect(result.expirationDate).toBe('2025-12-31');
        expect(result.lotNumber).toBe('LOT123');
      });
    });
  });
});
