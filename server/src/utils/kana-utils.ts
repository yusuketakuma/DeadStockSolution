/**
 * Convert katakana to hiragana.
 * Katakana range: U+30A1–U+30F6 → Hiragana range: U+3041–U+3096
 */
export function katakanaToHiragana(str: string): string {
  return str.replace(/[\u30A1-\u30F6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

/**
 * Convert hiragana to katakana.
 * Hiragana range: U+3041–U+3096 → Katakana range: U+30A1–U+30F6
 */
export function hiraganaToKatakana(str: string): string {
  return str.replace(/[\u3041-\u3096]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60)
  );
}
