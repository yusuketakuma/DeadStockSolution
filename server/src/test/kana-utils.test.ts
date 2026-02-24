import { describe, it, expect } from 'vitest';
import { katakanaToHiragana, hiraganaToKatakana } from '../utils/kana-utils';

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
});
