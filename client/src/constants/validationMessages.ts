/**
 * バリデーションメッセージ定数
 *
 * フォーム入力のバリデーションで使用するメッセージを一元管理する。
 * 将来的な国際化対応や一貫性のあるUX実現を目的とする。
 */

/**
 * 必須フィールド関連メッセージ
 */
export const REQUIRED_MESSAGES = {
  EMAIL_REQUIRED: 'メールアドレスを入力してください。',
  PASSWORD_REQUIRED: 'パスワードを入力してください。',
  NAME_REQUIRED: '薬局名を入力してください。',
  ADDRESS_REQUIRED: '住所を入力してください。',
  PHONE_REQUIRED: '電話番号を入力してください。',
  FAX_REQUIRED: 'FAX番号を入力してください。',
  POSTAL_CODE_REQUIRED: '郵便番号を入力してください。',
  PREFECTURE_REQUIRED: '都道府県を選択してください。',
  LICENSE_NUMBER_REQUIRED: '薬局開設許可番号を入力してください。',
  PERMIT_LICENSE_NUMBER_REQUIRED: '許可証記載の許可番号を入力してください。',
  PERMIT_PHARMACY_NAME_REQUIRED: '許可証記載の薬局名を入力してください。',
  PERMIT_ADDRESS_REQUIRED: '許可証記載の所在地を入力してください。',
  GENERIC_REQUIRED: 'この項目は必須です。',
} as const;

/**
 * メールアドレス形式関連メッセージ
 */
export const EMAIL_MESSAGES = {
  INVALID_FORMAT: 'メールアドレス形式で入力してください。',
  TOO_LONG: (max: number) => `メールアドレスは${max}文字以内で入力してください。`,
} as const;

/**
 * パスワード関連メッセージ
 */
export const PASSWORD_MESSAGES = {
  TOO_SHORT: 'パスワードは8文字以上で入力してください。',
  TOO_LONG: (max: number) => `パスワードは${max}文字以内で入力してください。`,
  REQUIRES_LETTER: 'パスワードにはアルファベットを含めてください。',
  REQUIRES_DIGIT: 'パスワードには数字を含めてください。',
  MISMATCH: 'パスワードが一致しません。',
  CONFIRMATION_REQUIRED: '確認用パスワードを入力してください。',
  HINT_LENGTH: '8文字以上',
  HINT_COMPLEXITY: '英字と数字を含む推測されにくいパスワードを設定してください。',
} as const;

/**
 * 電話番号・FAX番号関連メッセージ
 */
export const PHONE_MESSAGES = {
  INVALID_FORMAT: '正しい電話番号形式で入力してください。',
  TOO_SHORT: (min: number) => `電話番号は${min}文字以上で入力してください。`,
  TOO_LONG: (max: number) => `電話番号は${max}文字以内で入力してください。`,
} as const;

/**
 * 郵便番号関連メッセージ
 */
export const POSTAL_CODE_MESSAGES = {
  INVALID_FORMAT: '正しい郵便番号形式で入力してください（例: 1234567）。',
  TOO_SHORT: (min: number) => `郵便番号は${min}文字以上で入力してください。`,
  TOO_LONG: (max: number) => `郵便番号は${max}文字以内で入力してください。`,
} as const;

/**
 * 数値関連メッセージ
 */
export const NUMBER_MESSAGES = {
  INVALID_FORMAT: '数値を入力してください。',
  MUST_BE_POSITIVE: '正の数値を入力してください。',
  MUST_BE_INTEGER: '整数を入力してください。',
  TOO_SMALL: (min: number) => `${min}以上の数値を入力してください。`,
  TOO_LARGE: (max: number) => `${max}以下の数値を入力してください。`,
  OUT_OF_RANGE: (min: number, max: number) => `${min}から${max}の間の数値を入力してください。`,
} as const;

/**
 * 文字列長関連メッセージ
 */
export const LENGTH_MESSAGES = {
  TOO_SHORT: (min: number) => `${min}文字以上で入力してください。`,
  TOO_LONG: (max: number) => `${max}文字以内で入力してください。`,
  EXACT_LENGTH: (length: number) => `正確に${length}文字で入力してください。`,
  OUT_OF_RANGE: (min: number, max: number) => `${min}文字以上${max}文字以内で入力してください。`,
} as const;

/**
 * 日付・時刻関連メッセージ
 */
export const DATE_MESSAGES = {
  INVALID_FORMAT: '正しい日付形式で入力してください。',
  INVALID_TIME_FORMAT: '正しい時刻形式で入力してください。',
  FUTURE_DATE_REQUIRED: '未来の日付を入力してください。',
  PAST_DATE_REQUIRED: '過去の日付を入力してください。',
  START_DATE_AFTER_END: '開始日は終了日より前の日付を指定してください。',
  END_DATE_BEFORE_START: '終了日は開始日より後の日付を指定してください。',
  DATE_RANGE_INVALID: '開始日と終了日の順序が不正です',
} as const;

/**
 * 選択関連メッセージ
 */
export const SELECTION_MESSAGES = {
  PLEASE_SELECT: '選択してください。',
  INVALID_OPTION: '有効な選択肢を選んでください。',
  AT_LEAST_ONE_REQUIRED: '少なくとも1つ選択してください。',
} as const;

/**
 * ファイルアップロード関連メッセージ
 */
export const FILE_MESSAGES = {
  FILE_REQUIRED: 'ファイルを選択してください。',
  FILE_TOO_LARGE: (maxSize: string) => `ファイルサイズは${maxSize}以下にしてください。`,
  INVALID_FILE_TYPE: (allowedTypes: string) => `対応していないファイル形式です。${allowedTypes}形式のファイルを選択してください。`,
  INVALID_EXTENSION: (extensions: string) => `ファイル拡張子は${extensions}のいずれかを選択してください。`,
} as const;

/**
 * 検索関連メッセージ
 */
export const SEARCH_MESSAGES = {
  KEYWORD_REQUIRED: '検索キーワードを入力してください。',
  KEYWORD_TOO_SHORT: (min: number) => `検索キーワードは${min}文字以上で入力してください。`,
  KEYWORD_TOO_LONG: (max: number) => `検索キーワードは${max}文字以内で入力してください。`,
  NO_RESULTS: '検索結果が見つかりませんでした。',
} as const;

/**
 * 同意・確認関連メッセージ
 */
export const AGREEMENT_MESSAGES = {
  TERMS_AGREEMENT_REQUIRED: '免責事項に同意してください',
  PRIVACY_AGREEMENT_REQUIRED: 'プライバシーポリシーに同意してください。',
  CONFIRMATION_REQUIRED: '確認してください。',
  DELETE_IMPACT_ACKNOWLEDGE: (count: number) => `無効化・削除 ${count} 件の影響を確認しました`,
} as const;

/**
 * 全バリデーションメッセージ型
 */
export type ValidationMessages = typeof REQUIRED_MESSAGES
  & typeof EMAIL_MESSAGES
  & typeof PASSWORD_MESSAGES
  & typeof PHONE_MESSAGES
  & typeof POSTAL_CODE_MESSAGES
  & typeof NUMBER_MESSAGES
  & typeof LENGTH_MESSAGES
  & typeof DATE_MESSAGES
  & typeof SELECTION_MESSAGES
  & typeof FILE_MESSAGES
  & typeof SEARCH_MESSAGES
  & typeof AGREEMENT_MESSAGES;
