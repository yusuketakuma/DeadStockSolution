# tasks/lessons.md

## Repeated mistakes & counter-rules
- Pattern:
  - What happened:
  - Root cause:
  - New rule to prevent it:
- Pattern: レビュー指摘をそのまま適用しそうになり、ユーザーの明示意図（デモ資格情報は露出許容）との優先順位がぶれる
  - What happened: デモ資格情報露出に対するセキュリティ指摘を受け、非表示化前提で修正方針を取りかけた
  - Root cause: 一般的なセキュリティベストプラクティスを優先し、今回の要件意図を再確認する前に方針を進めた
  - New rule to prevent it: レビュー指摘がユーザー要件と衝突した場合、まず要件優先で可否を確定し、許容されたリスクは記録したうえで別の実害リスクのみ修正する
- Pattern: 画面実装時に「固定デモ値」を先に置き、実DB由来の要件（テスト薬局2件表示）を後追いで差し替えた
  - What happened: ログイン画面に固定デモ資格情報ボタンを先に追加した後、ユーザー指定でDB登録済みテスト薬局表示へ再実装になった
  - Root cause: データソース要件（固定値かDB参照か）を初手で明示確認せず、実装を先行した
  - New rule to prevent it: 認証/アカウント表示系UIは最初に「データの真実源（DB/API/env固定値）」を確定し、未確定なら表示UIと取得APIを分離して差し替えコストを最小化する
- Pattern: プレビュー環境で `NODE_ENV=production` になる前提を見落とし、デモ用APIが本番相当環境で404化した
  - What happened: `ENABLE_TEST_PHARMACY_PREVIEW=true` を明示しないと `GET /api/auth/test-pharmacies` が無効化され、Vercel上で404になった
  - Root cause: デプロイ先の実行環境（Preview/Productionともに `NODE_ENV=production`）を設計時に織り込めていなかった
  - New rule to prevent it: 「本番でも見せるデモ機能」はデフォルト有効で設計し、無効化は `...=false` の明示指定方式に統一する
- Pattern: デモアカウント選択UIで「メール自動入力」までで止まり、パスワード同時入力要件を満たせていなかった
  - What happened: テスト薬局選択時にメールのみセットし、ユーザーから「パスワードもセットでペースト」の追加入力が発生した
  - Root cause: デモログイン導線のゴール（選択後に即ログイン可能状態）を操作完了基準として定義していなかった
  - New rule to prevent it: 認証補助UIは「選択後に送信可能な最終フォーム状態」をDoDに含め、メール/パスワード両方を明示チェックする
- Pattern: 「誰が編集できるか」の権限境界を単独ロールで解釈し、管理者/ユーザー両要件の同時満足を初手で設計できなかった
  - What happened: 編集機能要件で管理者向け実装に寄せた後、ユーザー向け自店舗編集も同時に必要という補足が発生した
  - Root cause: 権限要件を「管理者のみ」または「ユーザーのみ」で早期に固定し、ロール別マトリクス（admin/all, user/self）で確認しなかった
  - New rule to prevent it: 編集機能は実装前に「ロール x 対象範囲（all/self）」の表を確定し、API/画面/導線をロール別に分離して設計する
- Pattern: デモ一覧APIで環境変数フィルタを優先しすぎ、要件変更後に表示件数が意図より減った
  - What happened: `TEST_PHARMACY_EMAILS` が設定されていると strict allowlist になり、ログイン画面のテスト薬局5件が表示されなかった
  - Root cause: 環境変数を「追加条件」でなく「唯一条件」として実装したため、運用時の古い設定が新要件を潰した
  - New rule to prevent it: デモ/プレビュー向けフィルタは allowlist と default pattern を OR 結合し、過去設定が新要件を阻害しない設計にする
- Pattern: デモアカウント要件で「全件同一パスワード」の実装を維持し、個別資格情報要件に追従できていなかった
  - What happened: ログイン画面で5件表示していてもパスワードが共通値だったため、要件「5件で異なるID/パスワード」を満たしていなかった
  - Root cause: デモ機能の初期要件（共通パスワード）を固定前提にして、後続の運用要件変更を設計へ反映しきれていなかった
  - New rule to prevent it: デモアカウントは「表示情報」と「実認証情報」を同一ソース（共通設定 + DBシード）で管理し、要件変更時にAPI/UI/DBを同時更新する
- Pattern: テスト薬局IDの再採番を単純更新で行おうとして外部キー制約に失敗した
  - What happened: `pharmacies.id` を update で 1..5 に寄せる処理が FK 制約で失敗した
  - Root cause: 参照先テーブルが存在する状態でPK更新しても `ON UPDATE NO ACTION` のため成立しない点を見落とした
  - New rule to prevent it: ID固定が必要なシードは「非対象データの存在チェック」→「安全条件下で truncate + reseed」方式を採用し、PK update 依存を避ける

## Project-specific gotchas
- Item:
  - Why it matters:
  - How to detect:
  - How to fix:
