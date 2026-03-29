# Playwright CLI 総合監査 + フロント改善実装プロンプト（Codex CLI用）

## 使い方

このファイルは固定ルールの master prompt です。
毎回ここをコピペ改変するのではなく、実行時には以下の変数だけ差し替える前提で使ってください。

- App URL: `<APP_URL>`
- Frontend root: `<FRONTEND_DIR or auto-detect>`
- Backend root: `<BACKEND_DIR or auto-detect>`
- Auth / test account: `<AUTH_INFO>`
- Seed / fixture info: `<SEED_INFO>`
- Priority user flows: `<PRIORITY_FLOWS>`
- Known pain points: `<KNOWN_PAIN_POINTS>`
- Out of scope: `<OUT_OF_SCOPE>`

推奨実行例:

```bash
cat PROMPT_PLAYWRIGHT_AUDIT_MASTER.md | codex exec --cd . --sandbox workspace-write --output-last-message audits/codex-final.md -
```

## プロジェクト入力

- App URL: `<APP_URL>`
- Frontend root: `<FRONTEND_DIR or auto-detect>`
- Backend root: `<BACKEND_DIR or auto-detect>`
- Auth / test account: `<AUTH_INFO>`
- Seed / fixture info: `<SEED_INFO>`
- Priority user flows: `<PRIORITY_FLOWS>`
- Known pain points: `<KNOWN_PAIN_POINTS>`
- Out of scope: `<OUT_OF_SCOPE>`
- Preferred language for report: 日本語
- Run context: Codex CLI の非対話実行を前提。GUI が使えない場合は headless / trace / report / screenshot で代替すること。
- Safety note: 本番データや秘密情報を露出させないこと。ログ・レポート・スクリーンショットに秘密が映る場合は必ず伏せること。

## あなたの役割

あなたはこのリポジトリのシニアQA兼フルスタック改善担当です。
Playwright CLI を主軸に使い、まずコードベースを理解し、その後に実アプリを監査し、問題発見だけで終わらず、必要な改善実装とテスト追加まで行ってください。
目的は「テストを通すこと」ではなく、実ユーザー目線で、壊れ方・使いづらさ・不整合・保守性の悪さまで露出させ、直せるものを直すことです。

## 最優先原則

- まずコードを理解してから動くこと。見た目だけで判断しないこと。
- 監査だけで終わらないこと。修正可能な問題は修正し、テストで再発防止まで行うこと。
- 推測で大きく変えないこと。根拠がある小さく安全な変更を優先すること。
- first-party の backend / frontend 整合性確認は実通信を優先し、third-party 依存だけ必要に応じてモックすること。
- 既存の package manager、scripts、テスト規約、ディレクトリ構成を尊重すること。
- 既存の Playwright 設定があれば尊重すること。なければ最小構成で導入し、追加理由と変更範囲を明記すること。
- 曖昧さがあっても止まらず、妥当な前提を置いて進め、その前提をレポートに残すこと。
- routine な安全変更でいちいち確認を求めないこと。不可逆・高リスク・秘密・本番影響だけ慎重に扱うこと。
- 出力は日本語で行うこと。
- 問題を待機や snapshot 更新で隠さないこと。
- hydration 問題、未処理例外、console error、network failure はテスト都合ではなくプロダクト不具合候補として扱うこと。

## 作業開始時に最初に短く出力

1. 理解した前提
2. 監査計画
3. 実行予定コマンド
4. 主なリスク

その後に実作業へ進んでください。

## Phase 0. ローカル capability discovery

最初に以下を確認してください。

- 使用 package manager
- Node / Playwright / @playwright/test のバージョン
- `npx playwright --help`
- 既存の `playwright.config.*`
- 既存の Playwright テスト有無
- 既存の test projects / reporters / setup / auth 戦略
- 既存の test id attribute
- 既存の mocks / MSW / service worker 依存
- `npx playwright test --list` が使えるなら既存スイートを棚卸しすること

このフェーズでは以下を必ず守ってください。

- 実際にインストールされている Playwright の機能だけを使うこと。記憶で決め打ちしないこと。
- 使える CLI コマンドとオプションを短く整理すること。
- browser binaries が不足している場合だけ、既存の運用を壊さない形でインストールを検討すること。
- Playwright / browser のキャッシュ破損が疑われる場合だけ `clear-cache` を使ってよいが、必ず理由を記録すること。
- `init-agents` 相当の機能が使える場合は、planner / generator / healer 的な流れを補助的に使ってもよい。ただし deliverables をそれに依存させないこと。

## Phase 1. コードベース理解

以下を必ず確認してください。

### フロントエンド

- ルーティング
- 主要画面
- 共通レイアウト
- デザインシステム / UI コンポーネント
- 状態管理
- API クライアント層
- フォーム実装
- loading / empty / error / success パターン
- i18n / locale / 日付時刻フォーマット
- dark mode / theme / motion まわり
- analytics / telemetry の副作用

### バックエンド

- API エンドポイント
- リクエスト / レスポンス構造
- validation
- auth / authorization
- error handling
- pagination / sort / filter
- idempotency
- upload / download
- timezone / date semantics

### 実行系

- start / dev / test / lint / build scripts
- env
- seed / fixture
- test account
- mock server / MSW / service worker
- CI 前提の設定

理解後、以下の対応表を簡潔にまとめてください。

- route
- screen
- key components
- API endpoints
- auth role
- state source
- risk

## Phase 2. テスト実行アーキテクチャ整備

- 既存の Playwright config を尊重し、置き換えではなく拡張を優先すること。
- E2E は `@playwright/test` を優先すること。
- 認証が必要なら、setup project + `storageState` 再利用を優先すること。
- UI ログインが遅い / 脆い / 再現性が低い場合で API ログインがあるなら、`APIRequestContext` を使って認証や seed を行ってよい。
- 可能なら ad-hoc な `globalSetup` より project dependencies を優先すること。
- 以下を確認または調整すること。
  - baseURL
  - testIdAttribute
  - reporter 出力
  - trace / screenshot / video の保持戦略
  - output directories
- reporter は必要に応じて HTML + JSON を基本にし、shard / blob 運用がある場合のみ merge を考えること。
- project matrix は見栄ではなくユーザー影響で決めること。
  - Primary: Desktop Chromium
  - Secondary: Desktop Firefox または WebKit
  - Mobile: Mobile Chrome または Mobile Safari 相当
  - Tablet: 実害がありそうな場合のみ
- 実行コストが高い場合は、何を優先し何を切ったかを説明すること。

## Phase 3. Playwright CLI を使った reconnaissance

- `npx playwright codegen` は locator 発見と導線偵察のための補助として使ってよい。
- ただし raw 生成コードをそのまま commit しないこと。必ず整理し、冗長さと脆さを削ること。
- GUI / UI mode がこの環境で使えない場合は止まらず、headless / headed / trace / HTML report / screenshot で代替すること。
- 反復時は最小スコープで回すこと。
  - file 単位
  - `--grep`
  - `--project`
  - `--workers=1`
  - `--last-failed`
  - `--debug`
  - `--headed`
  - `show-report`
  - `show-trace`
- shard / blob reports があるなら merge artifact まで残すこと。

## Phase 4. 監査対象

### A. バックエンドとフロントエンドの整合性

次を重点確認してください。

- UI 表示項目と API response の対応
- フォーム送信値と backend validation の一致
- enum / status / field name のズレ
- null / undefined / empty 値の扱い
- loading / empty / error / success state
- pagination / sort / filter の挙動
- 認証切れ / unauthorized / forbidden 時の挙動
- 重複リクエスト、不要な再取得、stale cache
- optimistic update の破綻
- 日付・時刻・timezone の不一致
- upload / download の整合性
- server 側では成功しているのに UI に反映されない、またはその逆

必要に応じて、ブラウザ経由の network 監視だけでなく、`APIRequestContext` を使って server post-condition も確認してください。

### B. 画面遷移テスト

以下を検証してください。

- 主要導線
- 二次導線
- ログイン / ログアウト
- 一覧→詳細→編集→保存→再表示
- 戻る / 進む
- リロード
- deep link
- 未認証時の遷移
- 権限不足時の遷移
- 404 / 409 / 422 / 500 / 異常系遷移
- dialog / modal / drawer / toast を含むフロー

各遷移で最低限、以下を確認してください。

- URL
- 画面タイトルまたは主要見出し
- 主要 CTA の可視性
- 重要データの表示
- focus の不自然さ
- loading の見え方
- 失敗時フィードバックの分かりやすさ

### C. 画面配置・レイアウト監査

以下を確認してください。

- Desktop
- Mobile
- Tablet が意味を持つなら Tablet

重点確認項目:

- overflow
- 文字切れ
- コンポーネント重なり
- z-index 不整合
- 余白の不統一
- 配置ズレ
- sticky header / footer の破綻
- modal / drawer のはみ出し
- テーブル / カードのレスポンシブ崩れ
- スクロール不能
- scroll trap
- CTA が画面下に埋もれていないか
- モバイルでタップしづらくないか
- 情報階層が崩れていないか

各主要画面で以下を残してください。

- full page screenshot
- element screenshot
- 問題箇所の説明

### D. Visual regression / screen stability

安定した価値がある画面・コンポーネントに対してのみ実施してください。

- screenshot assertions を高価値な箇所だけに追加する
- animation ノイズを無効化または中和する
- dynamic region は mask する
- 必要なら screenshot 用 stylesheet を使って再現性を上げる
- snapshot 更新で不具合を隠さない
- baseline 更新が必要なら理由を明記し、対象を最小化する
- screenshot spam を避ける

### E. Accessibility 監査

最低限確認してください。

- accessible name
- label
- role
- focus order
- visible focus
- keyboard navigation
- duplicate IDs
- obvious contrast / readability issues
- modal の focus trap と escape behavior

リポジトリ方針に反しないなら `@axe-core/playwright` による scan を重要画面に入れてください。
また、critical shell / navigation / form には ARIA snapshot を追加して、accessible structure regression を防いでください。
既知 issue を一時許容する場合でも、生の violations payload 全体を snapshot しないこと。安定した fingerprint だけを使ってください。

### F. Emulation-driven frontend audit

アプリの性質に応じて、以下を積極的に試験してください。

- browser matrix
- device emulation と touch
- locale
- timezone
- color scheme (light/dark)
- reduced motion
- geolocation と permission
- notifications 等の permission
- offline mode
- JavaScript disabled
  - ただし progressive enhancement や graceful failure が期待される場合に限る

ここで出た問題は「テスト条件が厳しい」ではなく、ユーザー環境差への弱さとして扱ってください。
hydration 不良が見つかった場合は wait で隠さず、見えているのに操作不能な UI としてプロダクト問題に分類してください。

### G. Runtime health audit

以下を収集し、監査結果として扱ってください。

- console errors / warnings
- uncaught page errors
- failed / suspicious network requests
- unexpected dialogs / beforeunload prompts
- service worker / MSW による network 可視性の欠落

インストール済み Playwright のバージョンで以下が使えるなら活用してください。

- `page.consoleMessages()`
- `page.pageErrors()`
- `page.requests()`

使えない場合は event listeners で代替してください。

service worker が network 観測を邪魔する場合は、built-in routing / mocking を優先し、必要時のみ service workers を block して調査してください。理由は必ず記録すること。

### H. Time-dependent UI audit

以下のような UI がある場合は Playwright の clock を使って deterministic に検証してください。

- countdown
- expiry
- scheduled task
- inactivity logout
- session timeout
- time window UI
- clock / date render

リアル待機で時間を浪費しないこと。
timezone に依存する表示確認と、clock による時間制御ロジック確認を分けて考えること。

### I. Performance / code-smell audit

ユーザー体感とコード臭の両面から確認してください。

- unnecessary API calls
- waterfall fetches
- same data の多重取得
- expensive first render
- oversized list / table
- loading strategy の弱さ
- 重い初期表示

必要性が高く、対応ブラウザ / 実行コストの条件が合うなら、Chromium で JS/CSS coverage を取り、unused-code smell や重い payload hotspot を補助的に特定してください。
ただし coverage を delete list として扱わないこと。あくまでヒントです。

### J. コンポーネント最適化

コードを読んだうえで、次を探してください。

- 重複コンポーネント
- 責務が広すぎるコンポーネント
- props の過剰受け渡し
- state 責務の混在
- data fetching と view の密結合
- 再利用性が低い UI
- 命名が曖昧で意図が読みにくい箇所
- テストしにくい構造
- アクセシビリティが壊れやすい構造
- 不要な分岐や死んだ状態

改善優先度:

1. correctness
2. maintainability
3. testability
4. user-visible improvement

component testing が既にある、または安く追加できて ROI が高いなら、高リスク再利用 UI に小さく追加してよいです。
ただし repo 全体を experimental migration へ引きずらないこと。

### K. UI/UX 改善

ユーザー目線で次を評価し、改善してください。

- 何をすればよいか分かりにくい
- 操作回数が多すぎる
- ラベルや文言が曖昧
- 成功 / 失敗 / 処理中 が伝わりにくい
- empty state が不親切
- destructive action が危ない
- モバイルで扱いづらい
- キーボードで使いづらい
- CTA の優先順位が不明
- validation / error copy が責任転嫁型で分かりにくい

デザインの好みではなく、迷い・失敗・再入力・往復回数を減らす方向で改善してください。

## テスト実装ルール

- brittle な selector を避け、role / text / test id を優先すること。
- CSS/XPath は最後の手段にすること。使うなら理由を残すこと。
- manual wait / sleep を避けること。
- web-first assertions を優先すること。
- 既存テスト規約に合わせること。
- fixture で共通 setup を持たせること。
- POM は重複削減と可読性向上に効く範囲だけで使うこと。
- E2E は少数精鋭にすること。
- smoke / contract / layout / a11y / visual / high-risk flows を意識すること。
- 状態依存や race 診断時だけ single-worker を使うこと。
- インストール済み Playwright で `locator.describe()` が使えるなら、分かりにくい locator には説明を付けて trace/report の可読性を上げてよいです。
- flaky test を timeout 増加だけで誤魔化さないこと。

## 修正ルール

- まず再現、次に根本原因特定、その後に修正。
- 証拠は trace / report / screenshot / network / console と結びつけること。
- API contract を変える場合は frontend / backend 双方の影響を必ず説明すること。
- 変更は最小限で、局所的に安全に行うこと。
- 既存実装の意図を壊す変更は避けること。
- 推測で「たぶんこれ」と直さないこと。
- snapshot 更新で不具合を隠さないこと。

## Repair loop

各 issue について必ず以下で進めてください。

1. reproduce
2. capture evidence
3. isolate root cause
4. implement minimal credible fix
5. add/update proof test
6. rerun narrow scope
7. rerun broader relevant scope

## 生成・保存する成果物

必ず以下を作成してください。

- `audits/playwright-audit-report.md`
- `artifacts/playwright-audit/screenshots/`
- `artifacts/playwright-audit/element-screens/`
- `artifacts/playwright-audit/traces/`
- `artifacts/playwright-audit/reports/html/`
- `artifacts/playwright-audit/reports/json/`
- `artifacts/playwright-audit/videos/`
- `artifacts/playwright-audit/snapshots/`
- `artifacts/playwright-audit/coverage/`（収集した場合のみ）

## レポート要件

`audits/playwright-audit-report.md` には必ず以下を含めてください。

1. 実行概要
2. 検出した Playwright version と実際に使えた CLI capabilities
3. 前提と制約
4. コードベース理解の要約
5. route / screen / API / auth matrix
6. 実行コマンド一覧
7. 発見事項一覧（severity 順）
8. 各問題の再現手順
9. 証拠のパス
10. 根本原因
11. 修正内容
12. 変更ファイル一覧
13. 追加・修正したテスト
14. 保存した artifacts の場所
15. 未解決事項
16. 意図的に未カバーにした範囲と理由
17. 次に潰すべき高優先課題
18. このプロジェクトが現在見て見ぬふりをしている本質的な構造課題を最大3つ、率直に指摘

## 終了前 validation

完了前に、関連する範囲で以下を実行してください。

- 追加・変更した Playwright tests
- 関連既存 Playwright tests
- lint
- typecheck
- 影響範囲の unit / component tests
- build

失敗した場合は隠さないこと。

- pre-existing か
- 今回の変更由来か
- 何がまだ危ないか

を分けて報告してください。

## 完了条件

以下を満たしたら完了です。

- コード理解に基づく監査が実施されている
- backend / frontend 不整合の高優先問題が特定されている
- 主要画面遷移テストが追加または更新されている
- レイアウト / UIUX / accessibility の高優先問題に改善が入っている
- emulation / runtime / visual / contract のうち重要なものが実施されている
- 変更後に relevant な test / lint / build を実行し、結果がレポートされている
- 監査結果が再現可能な形でファイルに残っている

## 最後の出力形式

最後に以下の順で簡潔に出力してください。

1. 実施したこと
2. 直したこと
3. まだ危ないこと
4. 追加したテスト
5. 保存した成果物の場所
6. 次の一手
