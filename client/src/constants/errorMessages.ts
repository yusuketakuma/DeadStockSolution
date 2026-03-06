/**
 * エラーメッセージ定数
 *
 * フロントエンド全体で使用するエラーメッセージを一元管理する。
 * 将来的な国際化対応や一貫性のあるUX実現を目的とする。
 */

/**
 * 共通エラーメッセージ
 */
export const COMMON_ERRORS = {
  NETWORK_ERROR: 'ネットワークエラーが発生しました',
  SERVER_ERROR: 'サーバーエラーが発生しました',
  UNKNOWN_ERROR: '不明なエラーが発生しました',
  REQUEST_FAILED: 'リクエストに失敗しました',
  FETCH_FAILED: 'データの取得に失敗しました',
  SAVE_FAILED: '保存に失敗しました',
  UPDATE_FAILED: '更新に失敗しました',
  DELETE_FAILED: '削除に失敗しました',
  REGISTRATION_FAILED: '登録に失敗しました',
  OPERATION_FAILED: '操作に失敗しました',
} as const;

/**
 * 認証関連エラーメッセージ
 */
export const AUTH_ERRORS = {
  LOGIN_FAILED: 'ログインに失敗しました',
  LOGIN_INVALID_CREDENTIALS: 'メールアドレスまたはパスワードが正しくありません',
  ADMIN_PERMISSION_REQUIRED: '管理者権限がありません',
  ACCOUNT_REJECTED: 'アカウント申請が却下されました。詳細はメールをご確認ください。',
  REGISTRATION_FAILED: '登録に失敗しました',
  REGISTRATION_FIELD_ERRORS: '入力内容にエラーがあります。各項目を確認してください。',
  PASSWORD_MISMATCH: 'パスワードが一致しません',
  PASSWORD_TOO_SHORT: 'パスワードは8文字以上で入力してください',
  PASSWORD_REQUIRES_LETTER: 'パスワードにはアルファベットを含めてください',
  PASSWORD_REQUIRES_DIGIT: 'パスワードには数字を含めてください',
  PASSWORD_RESET_REQUEST_FAILED: 'リクエストに失敗しました',
  PASSWORD_RESET_FAILED: 'リセットに失敗しました',
  WITHDRAW_PASSWORD_REQUIRED: '退会には現在のパスワードが必要です',
  WITHDRAW_FAILED: '退会処理に失敗しました',
  TEST_PHARMACY_FETCH_FAILED: 'テスト薬局情報の取得に失敗しました',
} as const;

/**
 * アップロード関連エラーメッセージ
 */
export const UPLOAD_ERRORS = {
  PREVIEW_FAILED: 'プレビューに失敗しました',
  EXCEL_PARSE_FAILED: 'Excel解析に失敗しました。',
  UPLOAD_FAILED: 'アップロード処理に失敗しました。',
  UPLOAD_ENQUEUE_FAILED: 'アップロード処理の受付に失敗しました。',
  UPLOAD_RESULT_FETCH_FAILED: 'アップロード処理結果の取得に失敗しました',
  UPLOAD_STATUS_FETCH_FAILED: 'アップロード処理状態の取得に失敗しました',
  UPLOAD_JOB_CHECK_FAILED: 'ジョブ状態の確認に失敗しました。',
  UPLOAD_CANCEL_FAILED: 'ジョブのキャンセルに失敗しました',
  DIFF_PREVIEW_FAILED: '差分プレビューに失敗しました',
  COLUMN_MAPPING_MISSING: '選択した取込種別の自動判定に必要な列が不足しています。ファイル見出しを確認してください。',
  PREVIEW_REQUIRED: '先にプレビューを実行してください',
  JOB_TIMEOUT: 'アップロード処理の待機時間が上限を超えました。',
  JOB_MAY_CONTINUE: 'ジョブは継続中の可能性があります。時間をおいて再確認してください。',
} as const;

/**
 * カメラ関連エラーメッセージ
 */
export const CAMERA_ERRORS = {
  CAMERA_PERMISSION_DENIED: 'カメラ権限が拒否されました。ブラウザ設定から許可してください',
  CAMERA_NOT_FOUND: '利用可能なカメラが見つかりません',
  CAMERA_START_FAILED: 'カメラ起動に失敗しました',
  CAMERA_INIT_FAILED: 'カメラ初期化に失敗しました',
  CAMERA_READ_FAILED: 'カメラ読取に失敗しました',
  CAMERA_VIDEO_NOT_READY: 'カメラ映像が取得できません',
  CAMERA_VIDEO_PREPARING: 'カメラ映像を準備中です。少し待って再実行してください。',
  CAMERA_IMAGE_PARSE_FAILED: 'カメラ画像の解析準備に失敗しました',
  CAMERA_START_REQUIRED: '先に「カメラ開始」を押してから実行してください',
  CAMERA_HTTPS_REQUIRED: 'カメラ利用にはHTTPS接続が必要です',
  CAMERA_BROWSER_UNSUPPORTED: 'このブラウザはカメラ機能に対応していません',
  CODE_NOT_FOUND_IN_IMAGE: '画像内に読取可能なコードが見つかりませんでした',
  CODE_DETECTION_FAILED: '画像からのコード検出に失敗しました',
  CODE_INPUT_REQUIRED: 'コードを入力してください',
  CODE_PARSE_FAILED: 'コード解析に失敗しました',
  CANDIDATE_SEARCH_FAILED: '候補検索に失敗しました',
  CANDIDATE_NOT_FOUND: '候補が見つかりませんでした。薬剤名やYJコードを変えて再検索してください。',
  BATCH_REGISTER_INVALID_ROWS: '未確定の行、または数量が0以下/未入力の行があります',
  BATCH_REGISTER_STATE_INVALID: '医薬品の確定状態に不整合があります。再度候補を確定してください',
  BATCH_REGISTER_EMPTY_CODE: 'コードが空の行があります。コードを入力してから登録してください',
  TORCH_TOGGLE_FAILED: 'ライト切替に失敗しました',
} as const;

/**
 * マッチング・提案関連エラーメッセージ
 */
export const MATCHING_ERRORS = {
  MATCHING_FAILED: 'マッチングに失敗しました',
  PROPOSAL_SEND_FAILED: '仮マッチングの送信に失敗しました',
  PROPOSAL_DETAIL_FETCH_FAILED: 'マッチング詳細の取得に失敗しました',
  COMMENTS_FETCH_FAILED: 'コメント一覧の取得に失敗しました',
  COMMENT_POST_FAILED: 'コメント投稿に失敗しました',
  COMMENT_UPDATE_FAILED: 'コメント更新に失敗しました',
  COMMENT_DELETE_FAILED: 'コメント削除に失敗しました',
  FEEDBACK_REGISTER_FAILED: '取引評価の登録に失敗しました',
} as const;

/**
 * アカウント関連エラーメッセージ
 */
export const ACCOUNT_ERRORS = {
  ACCOUNT_FETCH_FAILED: 'アカウント情報の取得に失敗しました',
  ACCOUNT_UPDATE_FAILED: '更新に失敗しました',
  ACCOUNT_NOTIFY_SAVE_FAILED: '通知設定の保存に失敗しました',
  ACCOUNT_CONFLICT_RELOAD: '他のデバイスまたはタブで更新されています。最新データを読み込みました。通知設定を確認して再度保存してください。',
  BUSINESS_HOURS_FETCH_FAILED: '営業時間の取得に失敗しました',
  BUSINESS_HOURS_UPDATE_FAILED: '営業時間の更新に失敗しました',
  BUSINESS_HOURS_DATA_MISSING: '営業時間データを取得できていないため保存できません。再読み込みしてください。',
  BUSINESS_HOURS_DATA_MISSING_EDIT: '営業時間データを取得できていないため編集できません。再読み込みしてください。',
  BUSINESS_HOURS_INVALID_WEEKLY: '通常営業時間の開店時間・閉店時間を正しく入力してください',
  BUSINESS_HOURS_INVALID_SPECIAL: '特別営業時間の開店時間・閉店時間を正しく入力してください',
  BUSINESS_HOURS_INVALID_DATE_RANGE: '特例営業時間の開始日と終了日の順序が不正です',
} as const;

/**
 * 在庫・データ関連エラーメッセージ
 */
export const DATA_ERRORS = {
  INVENTORY_FETCH_FAILED: '在庫データの取得に失敗しました',
  DEAD_STOCK_FETCH_FAILED: 'デッドストック一覧の取得に失敗しました',
  USED_MEDICATION_FETCH_FAILED: '医薬品使用量一覧の取得に失敗しました',
  DASHBOARD_FETCH_FAILED: 'ダッシュボードデータの取得に失敗しました',
  UPLOAD_STATUS_FETCH_FAILED: 'アップロード状況の取得に失敗しました。',
  EXPIRATION_RISK_FETCH_FAILED: '期限リスクの取得に失敗しました。',
  PRINT_DATA_FETCH_FAILED: '印刷データの取得に失敗しました',
} as const;

/**
 * 検索・入力関連エラーメッセージ
 */
export const INPUT_ERRORS = {
  SEARCH_KEYWORD_REQUIRED: '検索キーワードを入力してください',
  SEARCH_KEYWORD_TOO_SHORT: (min: number) => `検索キーワードは${min}文字以上で入力してください`,
  SEARCH_KEYWORD_TOO_LONG: (max: number) => `検索キーワードは${max}文字以内で入力してください`,
  COMMENT_BODY_REQUIRED: 'コメント本文を入力してください',
} as const;

/**
 * 全エラーメッセージ型
 */
export type ErrorMessages = typeof COMMON_ERRORS
  & typeof AUTH_ERRORS
  & typeof UPLOAD_ERRORS
  & typeof CAMERA_ERRORS
  & typeof MATCHING_ERRORS
  & typeof ACCOUNT_ERRORS
  & typeof DATA_ERRORS
  & typeof INPUT_ERRORS;
