import { describe, it, expect } from 'vitest';
import { katakanaToHiragana, hiraganaToKatakana, halfWidthToFullWidth, normalizeKana, fullWidthAlphanumToHalfWidth, halfWidthAlphanumToFullWidth } from '../utils/kana-utils';

describe('katakanaToHiragana', () => {
  it('converts katakana to hiragana', () => {
    expect(katakanaToHiragana('アセトアミノフェン')).toBe('あせとあみのふぇん');
  });

  it('leaves hiragana unchanged', () => {
    expect(katakanaToHiragana('あせとあみのふぇん')).toBe('あせとあみのふぇん');
  });

  it('leaves kanji unchanged', () => {
    expect(katakanaToHiragana('解熱鎮痛剤')).toBe('解熱鎮痛剤');
  });

  it('handles mixed content', () => {
    expect(katakanaToHiragana('アスピリン錠100mg')).toBe('あすぴりん錠100mg');
  });

  it('handles empty string', () => {
    expect(katakanaToHiragana('')).toBe('');
  });

  it('preserves long vowel mark (ー)', () => {
    expect(katakanaToHiragana('コーヒー')).toBe('こーひー');
  });

  it('handles dakuten characters', () => {
    expect(katakanaToHiragana('ガギグゲゴ')).toBe('がぎぐげご');
    expect(katakanaToHiragana('パピプペポ')).toBe('ぱぴぷぺぽ');
  });

  it('handles small kana', () => {
    expect(katakanaToHiragana('ァィゥェォ')).toBe('ぁぃぅぇぉ');
  });
});

describe('hiraganaToKatakana', () => {
  it('converts hiragana to katakana', () => {
    expect(hiraganaToKatakana('あせとあみのふぇん')).toBe('アセトアミノフェン');
  });

  it('leaves katakana unchanged', () => {
    expect(hiraganaToKatakana('アセトアミノフェン')).toBe('アセトアミノフェン');
  });

  it('leaves kanji unchanged', () => {
    expect(hiraganaToKatakana('解熱鎮痛剤')).toBe('解熱鎮痛剤');
  });

  it('handles mixed content', () => {
    expect(hiraganaToKatakana('あすぴりん錠100mg')).toBe('アスピリン錠100mg');
  });

  it('handles empty string', () => {
    expect(hiraganaToKatakana('')).toBe('');
  });

  it('handles dakuten characters', () => {
    expect(hiraganaToKatakana('がぎぐげご')).toBe('ガギグゲゴ');
    expect(hiraganaToKatakana('ぱぴぷぺぽ')).toBe('パピプペポ');
  });
});

describe('halfWidthToFullWidth', () => {
  it('converts basic half-width katakana', () => {
    expect(halfWidthToFullWidth('ｱｲｳｴｵ')).toBe('アイウエオ');
  });

  it('handles dakuten combinations', () => {
    expect(halfWidthToFullWidth('ｶﾞｷﾞｸﾞｹﾞｺﾞ')).toBe('ガギグゲゴ');
  });

  it('handles handakuten combinations', () => {
    expect(halfWidthToFullWidth('ﾊﾟﾋﾟﾌﾟﾍﾟﾎﾟ')).toBe('パピプペポ');
  });

  it('converts half-width long vowel mark', () => {
    expect(halfWidthToFullWidth('ｺｰﾋｰ')).toBe('コーヒー');
  });

  it('leaves full-width katakana unchanged', () => {
    expect(halfWidthToFullWidth('アイウエオ')).toBe('アイウエオ');
  });

  it('handles mixed half-width and full-width', () => {
    expect(halfWidthToFullWidth('ｱスピリン')).toBe('アスピリン');
  });

  it('handles empty string', () => {
    expect(halfWidthToFullWidth('')).toBe('');
  });

  it('preserves ASCII and kanji', () => {
    expect(halfWidthToFullWidth('ｱｾﾄｱﾐﾉﾌｪﾝ錠100mg')).toBe('アセトアミノフェン錠100mg');
  });
});

describe('normalizeKana', () => {
  it('normalizes half-width to full-width', () => {
    expect(normalizeKana('ｱｾﾄｱﾐﾉﾌｪﾝ')).toBe('アセトアミノフェン');
  });

  it('passes through full-width unchanged', () => {
    expect(normalizeKana('アセトアミノフェン')).toBe('アセトアミノフェン');
  });

  it('passes through hiragana unchanged', () => {
    expect(normalizeKana('あせとあみのふぇん')).toBe('あせとあみのふぇん');
  });

  it('normalizes full-width alphanumeric to half-width', () => {
    expect(normalizeKana('１０ｍｇ')).toBe('10mg');
  });

  it('normalizes mixed full-width alphanumeric and half-width katakana', () => {
    expect(normalizeKana('ｱｾﾄｱﾐﾉ錠１０ｍｇ')).toBe('アセトアミノ錠10mg');
  });
});

describe('fullWidthAlphanumToHalfWidth', () => {
  it('converts full-width digits to half-width', () => {
    expect(fullWidthAlphanumToHalfWidth('１０')).toBe('10');
  });

  it('converts full-width lowercase letters to half-width', () => {
    expect(fullWidthAlphanumToHalfWidth('ｍｇ')).toBe('mg');
  });

  it('converts full-width uppercase letters to half-width', () => {
    expect(fullWidthAlphanumToHalfWidth('Ａ１')).toBe('A1');
  });

  it('converts mixed full-width alphanumeric string', () => {
    expect(fullWidthAlphanumToHalfWidth('１０ｍｇ')).toBe('10mg');
  });

  it('leaves half-width characters unchanged', () => {
    expect(fullWidthAlphanumToHalfWidth('10mg')).toBe('10mg');
  });

  it('leaves katakana unchanged', () => {
    expect(fullWidthAlphanumToHalfWidth('アセトアミノフェン')).toBe('アセトアミノフェン');
  });

  it('leaves kanji unchanged', () => {
    expect(fullWidthAlphanumToHalfWidth('錠剤')).toBe('錠剤');
  });

  it('handles empty string', () => {
    expect(fullWidthAlphanumToHalfWidth('')).toBe('');
  });

  it('handles mixed content', () => {
    expect(fullWidthAlphanumToHalfWidth('アスピリン錠１００ｍｇ')).toBe('アスピリン錠100mg');
  });
});

describe('halfWidthAlphanumToFullWidth', () => {
  it('converts half-width digits to full-width', () => {
    expect(halfWidthAlphanumToFullWidth('10')).toBe('１０');
  });

  it('converts half-width lowercase letters to full-width', () => {
    expect(halfWidthAlphanumToFullWidth('mg')).toBe('ｍｇ');
  });

  it('converts half-width string to full-width', () => {
    expect(halfWidthAlphanumToFullWidth('10mg')).toBe('１０ｍｇ');
  });

  it('handles empty string', () => {
    expect(halfWidthAlphanumToFullWidth('')).toBe('');
  });
});
