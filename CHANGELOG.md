# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.18] - 2026-03-22

### テーマ: バーコードスキャンUX刷新 + 在庫検索設定の永続化 + 認証リファクタリング + 運用監視基盤

**バーコードスキャン画面を全面リニューアルし、ビューファインダー・サウンドフィードバック・統計バーを追加。在庫検索の条件・履歴・プリセットがサーバーに永続化され、端末を変えても同じ検索条件で作業を再開できるようになりました。認証ルートのWorkOS関連ロジックを分離し保守性を向上。SLO違反追跡サービスとフィーチャーフラグレジストリで運用監視の基盤を整備しています。**

---

#### 1. バーコードスキャンUXの全面刷新

**今まで**: バーコードスキャン画面はシンプルなカメラビューとモーダルのみで構成されていました。スキャン結果のフィードバックが弱く、何件スキャンしたか・マッチしたかが一目で分からず、サウンドによる通知もありませんでした。ビューファインダーのガイドもなく、初めて使うユーザーにはどこにバーコードをかざすべきか分かりにくい状態でした。

**今後**: カメラ画面にビューファインダーオーバーレイ（暗い周囲＋コーナーブラケット＋スキャンライン＋ガイドテキスト）を追加し、バーコードの位置合わせを直感的にしました。スキャン成功/失敗時にサウンドフィードバック（トグル可能）が鳴り、画面上部の統計バーで確定数・要確認数・合計がリアルタイム表示されます。スキャン結果シートも詳細表示に対応し、期限切れリスクの表示や数量編集がシート内で完結します。

**新規コンポーネント**:
- `ScanViewfinder` — ビューファインダーオーバーレイ
- `ScanStatsBar` — スキャン統計バー（確定/要確認/合計 + サウンドトグル）
- `useScanFeedback` — サウンドフィードバックフック

#### 2. 在庫検索設定のサーバー永続化

**今まで**: 在庫検索の条件（薬剤選択、フィルター、位置情報設定など）はブラウザのセッション内でのみ保持されていました。タブを閉じたり別の端末でアクセスすると、毎回ゼロから検索条件を設定し直す必要がありました。よく使う検索パターンを保存する手段もありませんでした。

**今後**: 検索条件のドラフト（作業中の状態）、検索履歴、保存済みプリセットがサーバーに自動保存されます。別の端末やブラウザからアクセスしても最後の検索状態が復元されます。楽観的ロック（version フィールド）で複数タブからの同時編集時の競合も検出・警告します。URLクエリパラメータとの双方向同期にも対応し、URLを共有して同じ検索条件を再現できます。

**新規エンドポイント**:
- `GET /api/account/inventory-search-preferences` — 設定の取得
- `PUT /api/account/inventory-search-preferences` — 設定の一括保存
- `PATCH /api/account/inventory-search-preferences/draft` — ドラフト部分更新
- `PATCH /api/account/inventory-search-preferences/history` — 検索履歴更新
- `PATCH /api/account/inventory-search-preferences/presets` — プリセット更新

**新規クライアントフック**:
- `useInventorySearchPreferencesPersistence` — サーバーとの永続化同期
- `useInventorySearchRouteSync` — URLクエリパラメータとの双方向同期

**DBマイグレーション**: `inventory_search_preferences` テーブル追加（`0035_inventory_search_preferences.sql`）

#### 3. 認証ルートのリファクタリング（WorkOS分離）

**今まで**: `server/src/routes/auth.ts` にWorkOS OAuth関連のロジック（認可URL生成、コールバック処理、オンボーディングトークン管理、CSRF検証など）がすべて含まれており、ファイルが肥大化していました。従来のパスワード認証とWorkOS認証のコードが混在し、見通しが悪くなっていました。

**今後**: WorkOS関連のルートハンドラを `auth-workos.ts` に分離しました。`auth.ts` は従来のパスワード認証に専念し、WorkOSルーターを `router.use()` でマウントする構成に変更。各ファイルの責務が明確になり、今後のメンテナンスが容易になります。

#### 4. SLO違反追跡サービス

**今まで**: ヘルスチェック失敗やレート制限超過などのSLO違反イベントを記録・参照する仕組みがありませんでした。問題が発生しても過去の履歴を遡って確認する手段がなく、再発パターンの分析が困難でした。

**今後**: `slo-tracking-service.ts` がSLO違反をメモリ内で記録（最大500件保持）。管理画面から `GET /api/admin/slo-breaches` で違反履歴を参照でき、`DELETE /api/admin/slo-breaches` でクリアできます。違反タイプ（`db_health`、`readiness`、`rate_limit`、`custom`）ごとの分類に対応しています。

#### 5. フィーチャーフラグレジストリ

**今まで**: 環境変数ベースのフィーチャーフラグが各ファイルに散在しており、どのフラグが存在するか、どの環境で有効かを把握するのが困難でした。

**今後**: `server/src/config/feature-flags.ts` にフラグ定義を一元管理するレジストリを追加。各フラグの環境変数名、説明、デフォルト値、対象環境が型安全に定義されています。新規コードはこのレジストリを参照してフラグの値を取得します。

#### 6. サーバー設定モジュールの分離

**今まで**: `app.ts` にCORS設定、ヘルスチェック、ミドルウェア登録、ルート登録、セキュリティ設定がすべて含まれていました。

**今後**: 以下の設定モジュールに分離し、`app.ts` の見通しを改善:
- `app-cors.ts` — CORS設定
- `app-health.ts` — ヘルスチェックエンドポイント
- `app-middleware.ts` — ミドルウェア登録
- `app-routes.ts` — ルート登録
- `app-security.ts` — セキュリティ設定（Helmet、レート制限等）

#### 7. DBスキーマ拡張

**今まで**: 先発品/後発品の同等性情報や管理操作の監査ログを格納するテーブルがありませんでした。

**今後**: 以下のテーブルを追加（`0036_nostalgic_loners.sql`）:
- `drug_equivalences` — 薬剤同等性マスター（先発⇔後発、後発⇔後発）
- `admin_audit_logs` — 管理者操作の監査ログ

#### 8. デザイン言語の調整

**今まで**: CSSカスタムプロパティの色味がやや薄く、コントラストが弱い箇所がありました。

**今後**: `design-language.css` の色トークンを微調整し、背景色・テキスト色・プライマリカラーのコントラストを改善。モバイルシート・ヘッダー・コンテンツエリアのスタイルも調整しています。

#### 9. Preview Smoke Test ワークフロー

**今まで**: preview ブランチへのプッシュ時に自動テストを実行するCIワークフローがありませんでした。

**今後**: `.github/workflows/preview-smoke.yml` を追加し、preview ブランチへのプッシュ時にスモークテストが自動実行されます。

#### 10. shared/ ワークスペース追加

**今まで**: クライアントとサーバーで共有する型定義やバリデーションスキーマの置き場所が統一されていませんでした。

**今後**: `shared/` ディレクトリをnpm workspaceとして追加。在庫検索設定の型定義・バリデーションスキーマを共有パッケージとして管理し、クライアント・サーバー双方から参照しています。

## [0.0.17] - 2026-03-21

### テーマ: API高速化（カーソルページネーション + N+1解消）+ マッチング複数薬剤対応 + WorkOS移行支援

**アラートとグループの一覧APIにカーソルベースのページネーションを導入し、大量データでも安定した応答速度を実現しました。グループメンバーシップの取得をN+1問題のない1回のAPIコールに集約。マッチング画面では在庫検索から渡された複数薬剤を同時にフィルタリングできるようになり、処方せん単位での在庫確認がよりスムーズになりました。WorkOS 認証への段階的移行を支援するレガシー認証の無効化フラグも追加しています。**

---

#### 1. カーソルベースページネーション（アラート・グループ一覧）

**今まで**: アラート一覧（`GET /api/alerts`）とグループ一覧（`GET /api/groups`）は `offset` / `limit` 方式でページ送りしていました。これは「100ページ目」のように後半のページを取得するときに `OFFSET 2000` のようなクエリが走り、データベースが先頭から2000件をスキャンしてから結果を返す必要がありました。アラートが数千件ある大規模薬局では、ページ後半の表示に数秒かかることがありました。

**今後**: `cursor` クエリパラメータを指定すると、前回取得した最後のレコードの位置（base64urlエンコードされたJSON）を基準に次のページを取得します。データベースはインデックスを使って直接そのポイントから読み始めるため、何ページ目であっても一定の応答速度を維持します。

**対象エンドポイント:**
- `GET /api/alerts?cursor=<base64url>` — `detectedAt` + `id` の複合カーソル
- `GET /api/groups?cursor=<base64url>&tab=mine|public` — `createdAt` + `id` の複合カーソル

**レスポンス形式** — 既存の `offset`/`limit` フィールドに加え、新しい `pagination` オブジェクトが追加されます:

```json
{
  "alerts": [...],
  "total": 156,
  "offset": 0,
  "limit": 20,
  "unresolvedCount": 42,
  "pagination": {
    "mode": "cursor",
    "hasMore": true,
    "nextCursor": "eyJpZCI6NDIsImRldGVjdGVkQXQiOiIyMDI2LTAzLTIwVDA5OjMwOjAwLjAwMFoifQ"
  }
}
```

**後方互換性**: `cursor` パラメータを省略すると従来通り `offset` / `limit` 方式で動作します。既存のフロントエンドコードは変更不要です。`pagination.mode` が `"offset"` の場合は従来方式、`"cursor"` の場合はカーソル方式であることを示します。

**バリデーション**: 不正な `cursor` 値（改ざんされたbase64、期待するフィールドがないJSON等）には HTTP 400 を返します。有効期限切れのカーソル（該当レコードが削除済み等）は先頭から再取得するフォールバック動作です。

**共通ユーティリティ**: `server/src/utils/cursor-pagination.ts` に `encodeCursor<T>` / `decodeCursor<T>` / `parseCursor<T>` を実装。型安全なカーソルの生成・パース・バリデーションをルートハンドラ間で再利用しています。

#### 2. グループメンバーシップ一括取得（N+1クエリ解消）

**今まで**: マッチング画面（`MatchingPage`）と薬局一覧（`PharmacyListPage`）では、自分と同じグループに所属する薬局を判定するために以下のAPIコールを順番に実行していました:

1. `GET /api/groups?tab=mine` → 所属グループ一覧を取得
2. `GET /api/groups/:id` × N回 → 各グループの詳細（メンバーリスト）を取得

グループが5つあれば合計6回のHTTPリクエストが発生し、画面表示が遅延していました。さらに、フロントエンドの `useGroupMembership` フック内で `collectGroupPharmacyIds()` 関数を使って全グループのメンバーIDを手動で集約する処理も必要でした。

**今後**: 新しいエンドポイント `GET /api/groups/membership-summary` が、所属グループ名・各グループのメンバー薬局ID・全グループのメンバー薬局IDの重複排除済みリストを **1回のAPIコール** で返します:

```json
{
  "groups": [
    { "id": 1, "name": "東京薬剤師会", "memberPharmacyIds": [10, 20, 30] },
    { "id": 2, "name": "品川エリア連携", "memberPharmacyIds": [10, 40, 50] }
  ],
  "groupPharmacyIds": [10, 20, 30, 40, 50]
}
```

**フロントエンドの改善**: `useGroupMembership` フックは `collectGroupPharmacyIds()` ヘルパー関数と `Promise.all` による個別取得を削除し、単一のAPIコールに置き換わりました。コード量が27行から58行中27行削減され、ロジックが大幅にシンプルになっています。

**サーバー側の実装**: `group-service.ts` に `getMembershipSummary()` 関数を追加。内部では自分の所属グループIDの取得とそのグループの全メンバー取得を `Promise.all` で並列実行し、`Map` でグループごとのメンバーIDを集約しています。

#### 3. グループ一覧のタブフィルタリング最適化

**今まで**: `GET /api/groups` は `tab` パラメータの有無にかかわらず、自分の所属グループと公開グループの両方のクエリを常に実行していました。「自分のグループだけ見たい」場合でも、不要な公開グループのクエリが走っていました。

**今後**: `tab=mine` の場合は公開グループのクエリをスキップ、`tab=public` の場合は自分のグループのクエリをスキップします。タブ指定なしの場合は従来通り両方を取得して重複排除します。不要なDBクエリが減り、特に公開グループが多い環境でのレスポンスが改善されました。

#### 4. マッチング画面の複数薬剤フィルタリング

**今まで**: マッチング画面で在庫検索ページから遷移した場合、`requestedDrug` パラメータで **1つの薬剤名** のみフィルタリングできました。在庫検索で複数薬剤をチップ入力して検索した場合でも、マッチング画面では最初の薬剤しか反映されず、他の薬剤の候補を見るには手動で再検索する必要がありました。

**今後**: 在庫検索から渡された `inventorySearchDrugs`（`/` 区切りの複数薬剤名）を `parseRequestedDrugTerms()` 関数でパースし、すべての薬剤に対してAND条件ではなくOR条件でマッチング候補をフィルタリングします。処方せん1枚に含まれる複数の薬剤について、関連するマッチング候補がすべて表示されるようになりました。

```
// 在庫検索から渡されるパラメータ例
inventorySearchDrugs=ロキソプロフェン錠60mg/アムロジピン錠5mg/メトホルミン錠250mg

// パース結果
["ロキソプロフェン錠60mg", "アムロジピン錠5mg", "メトホルミン錠250mg"]

// フィルタリング: いずれかの薬剤名を含むマッチング候補を表示
```

**UI改善**: フィルタリング中は「対象薬剤: ロキソプロフェン錠60mg/アムロジピン錠5mg/メトホルミン錠250mg（一致候補を優先表示）」のようにすべての対象薬剤が表示されます。

#### 5. レガシーパスワード認証の無効化フラグ（WorkOS移行支援）

**今まで**: WorkOS（SSO/ソーシャルログイン）への認証移行を進めていましたが、旧来のパスワード認証エンドポイント（ログイン `POST /api/auth/login`、ユーザー登録 `POST /api/auth/register`、パスワードリセット `POST /api/auth/reset-password`）を無効化する手段がありませんでした。コードを削除するまで旧認証が残り続ける状態でした。

**今後**: 環境変数 `LEGACY_PASSWORD_AUTH_ENABLED=false` を設定すると、上記3つのエンドポイントが即座に HTTP 410 Gone（「パスワード認証は廃止されました。WorkOS 認証をご利用ください。」）を返すようになります。

**段階的移行のシナリオ**:
1. まず WorkOS 認証を有効化し、既存ユーザーが両方の認証方式を使える状態にする
2. 全ユーザーが WorkOS に移行したことを確認後、`LEGACY_PASSWORD_AUTH_ENABLED=false` を設定
3. 問題があれば環境変数を削除するだけで即座にロールバック可能
4. 安定したらコードを削除

**実装の詳細**: `isLegacyPasswordAuthDisabled()` と `respondLegacyAuthGone()` のヘルパー関数を追加。各エンドポイントのハンドラ先頭でガードチェックを行い、後続のバリデーションやDB操作は一切実行されません。

#### 6. 在庫検索のグループフィルタ最適化

**今まで**: `inventory-search-service.ts` の在庫検索クエリでは、`groupOnly` フィルタの有無にかかわらず、常にグループメンバーIDの取得クエリ（自分の所属グループ → そのグループの全メンバー取得）が `Promise.all` 内で実行されていました。グループに所属していないユーザーの通常検索でも、不要なDBクエリが2回走っていました。

**今後**: `groupOnly` フィルタが `true` の場合のみグループメンバーのクエリを実行します。通常の在庫検索では空の `Set` が返され、不要なDBアクセスが発生しません。また、`groupMemberIds` の型を `Set<number> | null` から常に `Set<number>` に統一し、下流のフィルタリングロジックでの null チェックを不要にしました。

#### 7. 在庫検索プリファレンスのスキーマ追加

`inventory_search_preferences` テーブルを `schema-pharmacy.ts` に追加。薬局ごとの在庫検索の下書き状態、検索履歴、保存済みプリセットを JSONB カラムで保持し、将来の検索UX向上の基盤を整備しています。バージョニング用の `version` カラムにより、スキーマ変更時のマイグレーションに対応します。

#### 8. テスト拡充

以下のテストファイルを追加・拡充し、新機能の動作を網羅的に検証しています:

| テストファイル | 追加内容 |
|---------------|---------|
| `alert-routes.test.ts` | カーソルパラメータのバリデーション、不正cursor時の400レスポンス |
| `group-routes.test.ts` | `/groups/membership-summary` の正常系、タブフィルタリング、カーソルページネーション |
| `group-service.test.ts` | `getMembershipSummary()` のユニットテスト、空グループ・複数グループのケース |
| `inventory-search-service.test.ts` | `groupOnly=false` 時のグループクエリ非実行の検証 |
| `matching-page-groups.test.tsx` | `useGroupMembership` の新API呼び出しに対応したモック更新 |
| `pharmacy-list-groups.test.tsx` | 同上 |
| `routes-meta.test.tsx` | ルートメタデータの整合性テスト更新 |
| `smart-digest.test.tsx` | スマートダイジェストのテスト更新 |

#### 9. 依存関係の更新

以下の依存関係を最新バージョンに更新:

- `@vitest/coverage-v8`: 4.0.18 → 4.1.0
- `typescript-eslint`: 8.56.1 → 8.57.0
- `@commitlint/cli`: 20.4.3 → 20.5.0
- `@electric-sql/pglite`: 0.3.15 → 0.3.16
- `@types/supertest`: 6.0.3 → 7.2.0
- `fast-xml-parser`: 5.4.2 → 5.5.5

---

## [0.0.16] - 2026-03-20

### テーマ: 在庫検索の全面刷新 + セキュリティ大幅強化

**処方せんに含まれる複数の医薬品をまとめて在庫検索できるようになりました。さらに、厚生労働省「3省2ガイドライン」に準拠したセキュリティ強化を実施し、個人情報の保護と安全性を向上させています。**

---

#### 1. 処方せんの医薬品をまとめて在庫検索

**今まで**: 在庫を探すには医薬品を1つずつ検索バーに入力し、それぞれの結果を見比べる必要がありました。処方せん1枚に5〜10種類の薬が記載されている場合、検索を何度も繰り返すことになり、非常に手間がかかっていました。

**今後**: 「在庫検索」ページで複数の医薬品名をチップ（タグ）として一度に入力できます。薬品名を入力して選択するたびにチップが追加され、検索ボタンを押すとすべての医薬品の在庫状況がマトリクス表で一覧表示されます。どの薬局にどの薬がいくつあるか、スコア付きで一目でわかります。

```
[ロキソプロフェン錠60mg ×] [アムロジピン錠5mg ×] [メトホルミン錠250mg ×]

薬局名           | ロキソプロフェン | アムロジピン | メトホルミン | スコア
─────────────────┼─────────────────┼─────────────┼─────────────┼───────
みどり薬局       |      120個      |     45個    |     80個    |  92点
さくら薬局       |       60個      |     30個    |      —      |  65点
```

#### 2. 薬局ごとの在庫サマリーカード

**今まで**: 検索結果は薬品ごとのリスト表示のみで、「この薬局にまとめて頼めるか？」という判断がしにくい状態でした。

**今後**: 検索結果の上部に薬局ごとのサマリーカードが表示されます。各薬局が検索した薬のうち何品目を保有しているか、合計在庫数、マッチングスコアがカード形式でひと目で確認できます。「営業中のみ」フィルターで、今すぐ連絡できる薬局だけに絞り込むことも可能です。

#### 3. 営業時間による絞り込み（リアルデータ連携）

**今まで**: 薬局の営業状況はシステム上で確認できず、電話して初めて「今日は休みです」と言われることがありました。

**今後**: 「営業中のみ」トグルをONにすると、各薬局が登録した実際の営業時間データに基づいて、現在営業中の薬局だけを表示します。休日・営業時間外の薬局は自動的にフィルタリングされ、確実に連絡が取れる相手だけに絞り込めます。

#### 4. セキュリティ強化：3省2ガイドライン準拠

**今まで**: 基本的なセキュリティ対策は実装済みでしたが、医療情報システムに求められる「3省2ガイドライン」の要件を網羅していませんでした。

**今後**: 以下のセキュリティ機能を追加し、医療情報の安全管理に関する国のガイドラインに準拠しました。

| 対策 | 内容 |
|------|------|
| **監査ログ** | ログイン・データ変更・API操作を記録。誰がいつ何をしたか追跡可能 |
| **個人情報保護（PII scrub）** | ログや外部送信データから個人情報を自動除去 |
| **強力なパスワードポリシー** | 8文字以上・大小英字・数字・記号を必須に変更 |
| **パスワード再利用防止** | 過去に使用したパスワードの再利用をブロック |
| **セッションタイムアウト** | 一定時間操作がないと自動ログアウト |
| **ログインアラート** | 新しいデバイスからのログイン時に通知 |
| **HSTS** | 通信の常時暗号化を強制 |

#### 5. レート制限の安定性修正

**今まで**: APIのレート制限機能にキーの衝突とメモリリークの問題があり、長時間運用で制限が正しく動作しないケースがありました。

**今後**: レート制限のキー生成ロジックを修正し、メモリリークを解消しました。長時間の連続運用でも安定してAPI保護が機能します。

#### 6. テストカバレッジの大幅拡充

**今まで**: 一部のUIコンポーネントやフックにテストがなく、変更時の品質担保が不十分でした。

**今後**: 30以上のテストファイルを新規追加・修正し、サーバー284ファイル・クライアント92ファイルの全テストがパスする状態を維持しています。アカウント設定、カメラ、ダッシュボード、サイドバー、統計ページなど、主要なUIコンポーネントすべてにテストが追加されました。

---

## [0.0.15] - 2026-03-18

### テーマ: モバイルUX完全強化 + 全画面検索機能拡張

**スマートフォンでの操作性を大幅強化。スワイプ・ピンチ・バーコードスキャンなどのジェスチャー操作を実装し、トークナイズAND検索をシステム全体に展開。ScrollAreaレイアウトの不具合も全画面修正。**

---

#### 1. スワイプ操作でデッドストック・在庫を直感的に操作

**今まで**: リスト上のアイテムを操作するにはタップして詳細ページを開き、ボタンを押す必要がありました。モバイルでの繰り返し操作が煩雑でした。

**今後**: デッドストック一覧・在庫一覧の各アイテムを左スワイプするだけで操作メニューが現れます。誤操作した場合も「元に戻す」トーストが5秒間表示され、一発でキャンセルできます。初回利用時はコーチングオーバーレイでジェスチャーの使い方を案内します。

```
← スワイプ → [操作ボタン]  「元に戻す」5秒トースト付き
```

#### 2. 引っ張って更新（プルトゥリフレッシュ）

**今まで**: 最新データを表示するには画面を閉じて開き直すか、手動でリロードするしかありませんでした。

**今後**: 5ページ（デッドストック一覧・在庫一覧・マッチング・グループ・タイムライン）で画面を下に引っ張ると最新データに更新できます。引っ張り量に応じてスピナーが表示され、離した瞬間にリフレッシュが走ります。

#### 3. バーコードスキャンで医薬品を即検索

**今まで**: 医薬品の在庫検索はYJコードや商品名を手入力する必要がありました。手元にある薬を素早く確認する手段がありませんでした。

**今後**: デッドストック一覧・在庫閲覧ページの検索バーにバーコードアイコンが追加されました。タップするとカメラが起動し、医薬品パッケージのバーコードをスキャンするだけで該当商品を自動検索します。GS1コード・JANコード・HOTコードに対応。

#### 4. ピンチズームで薬品詳細をじっくり確認

**今まで**: スマートフォンで薬品詳細画面を表示しても、文字が小さく読みにくい場面がありました。OSの画面ズームを使うとレイアウトが崩れることも。

**今後**: 薬品詳細ビューでピンチイン・ピンチアウトのズーム操作ができます。最小0.8倍〜最大3倍まで拡大可能で、コンテンツ自体がズームするため文字や情報がはっきり確認できます。

#### 5. 画面間スワイプナビゲーション（タブ切り替え）

**今まで**: 下部ナビゲーションのタブを切り替えるには、タブアイコンを正確にタップする必要がありました。

**今後**: 画面を左右にスワイプするだけで隣のタブに移動できます。スワイプ速度が一定以上の場合のみ反応するため、スクロール操作と誤検知しません。

#### 6. モバイル向けフィルター・ソートシート

**今まで**: フィルターとソートのUIがデスクトップ向けのドロップダウンのみで、スマートフォンでは操作しにくい状態でした。

**今後**: モバイル画面では「絞り込み」「並び替え」ボタンをタップすると画面下からボトムシートが滑り込んで表示されます。指で操作しやすい大きなボタンで選択でき、完了ボタンで即座に反映されます。デッドストック一覧・在庫一覧の両ページで利用可能。

#### 7. インクリメンタル検索（入力しながらリアルタイム絞り込み）

**今まで**: 検索ワードを入力してEnterを押すか検索ボタンをタップしないと結果が更新されませんでした。

**今後**: デッドストック一覧・在庫一覧・マッチングページで、文字を入力するたびに結果がリアルタイムで絞り込まれます。300msのデバイアンス処理で不要なAPI呼び出しを抑制し、前回の検索をキャンセルして最新の入力に素早く対応します。

#### 8. 検索チップとステータス表示

**今まで**: 現在どの条件で絞り込んでいるかが一目でわかりませんでした。検索結果が0件でも理由がわかりにくい状態でした。

**今後**: 適用中のフィルター条件が「検索チップ」として検索バーの下に表示されます。チップのXボタンで個別に解除可能。また検索結果件数と「〇件中〇件表示」のステータスが常に表示されます。

#### 9. トークナイズAND検索をシステム全体に展開

**今まで**: 医薬品名の検索は一部の画面でのみ日本語対応（ひらがな・カタカナ変換）していました。複数キーワードをスペースで区切っても「AND検索」は機能しませんでした。管理画面では単純な部分一致のみでした。

**今後**: 以下の全画面でトークナイズAND検索が有効になりました。スペース区切りで複数キーワードを入力すると、すべてのキーワードに一致するもののみ表示されます。ひらがな・カタカナ・全角・半角の表記ゆれも自動で吸収します。

| 画面 | 検索対象 |
|------|---------|
| デッドストック一覧 | 薬品名・YJコード |
| 在庫一覧 | 薬品名・YJコード |
| マッチング | 薬品名・YJコード |
| 管理 > 薬局一覧 | 薬局名・メールアドレス |
| 管理 > 医薬品マスター | 薬品名・YJコード |
| 管理 > 薬品等価一覧 | 薬品名A・薬品名B |
| 管理 > アップロードジョブ | ファイル名・薬局名 |
| 管理 > ログセンター | 各ログ種別の検索列 |
| グループ管理 | グループ名 |
| 薬品マッチング候補生成 | 薬品名・一般名 |

#### 10. 各画面のレイアウト崩れを修正

**今まで**: デッドストック一覧・在庫一覧・マッチング・管理薬局一覧・管理ログセンター・医薬品マスター管理の6ページで、コンテンツが画面下部に隠れてスクロールできない問題がありました。

**今後**: 全6ページのScrollAreaの適用範囲を修正。ページ全体が正しくスクロール可能になり、検索バー・フィルターを含むすべてのコンテンツが表示されます。

#### 11. 医薬品マスター管理ページの全面刷新

**今まで**: 管理者向けの医薬品マスター管理ページで、「厚生労働省サイトからの自動取得」メニューが表示されず、一覧も表示できない状態でした。

**今後**: レイアウト問題を根本修正し、自動取得メニュー・一覧・フィルターがすべて正常に表示されます。薬品名・YJコードでのトークナイズ検索、収載状態（収載中/移行中/削除済み）での絞り込みが使えます。

---

## [0.0.14] - 2026-03-17

### テーマ: データベーススキーマ ゼロベース再設計 + UI/UX改善スプリント

**44テーブル・9ファイルを40テーブル・13ファイルにゼロベース再設計。冗長テーブル4つを廃止し、ドメイン別ファイル分割・JSON jsonb統一・export名整理を実施。UI/UX改善25タスクも完了。**

---

#### 1. データベーススキーマ再設計: 冗長テーブル4つを廃止

**今まで**: `exchange_history`、`pharmacy_trust_scores`、`match_notifications`、`uploads` の4テーブルが親テーブルのデータを重複して保持。更新時に2テーブルへの二重書き込みが必要で、不整合リスクがありました。

**今後**: 冗長テーブルを完全廃止し、親テーブルにカラムを追加して統合。

| 廃止テーブル | 統合先 | 方法 |
|-------------|--------|------|
| `exchange_history` | `exchange_proposals` | `completed_total_value` カラム追加 + `status='completed'` フィルタ |
| `pharmacy_trust_scores` | `pharmacies` | `trust_score`, `rating_count`, `positive_rate` カラム追加 |
| `match_notifications` | `notifications` | `detail_json`, `source_pharmacy_id`, `dedupe_key` カラム追加 |
| `uploads` + `upload_confirm_jobs` | `upload_jobs` | 統合テーブルにリネーム |

#### 2. スキーマファイルのドメイン別分割

**今まで**: `schema-auth.ts` に薬局・グループ・認証が混在、`schema-admin.ts` に監査・分析・OpenClawが混在。1ファイルが200行超で見通しが悪い状態でした。

**今後**: 9ファイルを13のドメイン別ファイルに再編。

```
schema-auth.ts    → schema-pharmacy.ts + schema-pharmacy-group.ts + schema-auth.ts
schema-admin.ts   → schema-audit.ts + schema-analytics.ts + schema-openclaw.ts
schema-upload-jobs.ts → schema-inventory.ts に統合
```

#### 3. JSON text → jsonb 一括変換

**今まで**: 12カラムが `text` 型で JSON 文字列を格納。読み取り時に毎回 `JSON.parse`、書き込み時に `JSON.stringify` が必要でした。

**今後**: 全12カラムを `jsonb` 型に変換。Drizzle ORM が自動で JSON ↔ オブジェクト変換するため、手動の parse/stringify が不要に。PostgreSQL のネイティブ JSON 演算子も利用可能に。

#### 4. export 名の整理

**今まで**: `activityLogs` という export 名が、テーブルの用途（イベント記録）と乖離していました。

**今後**: `activityLogs` → `events` にリネーム（DBテーブル名 `activity_logs` は維持）。14ファイルの参照を一括更新。

#### 5. コードレビュー指摘の修正

- `parseTopCandidates` に `Array.isArray` ガード追加（unsafe cast 防止）
- `exchangeProposals` に completed クエリ用の部分インデックス2つ追加
- `parseMatchDiff` を `unknown` 受付可に変更、diff の二重 serialize/parse を解消
- truncated `detailJson` を bare string → 構造化オブジェクト `{ _truncated, preview }` に統一
- `mappingJson` のべき等性比較をキーソート済み `stableStringify` に変更

#### 6. UI/UX 改善スプリント (25タスク)

- フォームバリデーション強化・前提条件チェック・バッジポーリング
- 自動スクロール・ソート可能テーブル・提案ステータス表示
- パンくずリスト・サイドバー a11y・スケルトンUI
- ダイジェスト・アラート・エラー構造・タブレット対応
- bootstrap-icons 導入・各種アクセシビリティ修正

#### 7. サーバーサイド コード簡素化

- 38ファイルのリファクタリング（services + routes）
- レスポンスヘルパー統合・型ガード抽出
- 4,610テスト全パス維持

---

## [0.0.13] - 2026-03-16

### テーマ: 管理者パネル全面強化 + ユーザー/管理者アクセス分離

**管理者が必要とする運用・監査・分析機能を13ページ追加し、サイドバーを折りたたみ可能なカテゴリ構成に刷新。管理者と一般ユーザーのアクセス領域を完全分離。**

---

#### 1. 管理者パネル: 13の新規ページ

**今まで**: 管理者パネルは11メニュー。52テーブル中の多くがadmin UIを持たず、グループ管理・アラート管理・監査ログ・営業時間一覧などはDBを直接確認する必要がありました。

**今後**: 以下13ページを新規追加。すべてフィルター、ページネーション、レスポンシブ対応（PC/モバイル）を装備。

| ページ | 機能 |
|--------|------|
| ユーザーリクエスト管理 | ステータス・薬局・日付フィルター |
| グループ管理 | メンバー詳細モーダル + メンバー除外 |
| アラート管理 | 一括解決 + 傾向分析 |
| 一括操作 | CSV一括インポートによる薬局承認/停止 |
| 関係性監査 | お気に入り/ブロック関係一覧 |
| 通知・配信状況 | 統計 + プッシュ購読健全性 |
| OpenClawコマンド | ホワイトリストCRUD管理 |
| 薬局ヘルス | アクティビティ集計 + 信頼スコア一覧 |
| マッチング性能 | 成立率推移 + 候補分布 |
| アップロード品質 | エラーコード分類 + 薬局別傾向 |
| 監査ログ | 全管理者操作履歴 + アクションフィルター |
| 営業時間カレンダー | 通常営業 + 特別営業/休業日 |
| CSVエクスポート強化 | ログ・リスクデータのCSVダウンロード |

#### 2. サイドバー刷新: 折りたたみ可能サブグループ + リアルタイムバッジ

**今まで**: 管理者メニューは23項目のフラットリスト。目的ページを探すのにスクロールが必要。未読件数の表示もなし。

**今後**: 管理者メニューを8カテゴリ（薬局運用/リクエスト・通知/マッチング・交換/在庫・取込/医薬品マスター/分析・監視/OpenClaw）に整理。クリックで展開・折りたたみ可能、状態はブラウザに保存。ユーザー側も4カテゴリに再編。リアルタイムバッジ（60秒更新）で要対応提案数・未解決アラート数・未読通知数を表示。

#### 3. 管理者/ユーザー アクセス完全分離

**今まで**: 管理者アカウントでも一般ユーザー向けページ（在庫・マッチング・提案等）にアクセス可能。

**今後**: サーバー側 `rejectAdmin` ミドルウェアで管理者のユーザーAPI利用を403ブロック。フロントエンドも `userOnly` ルートで管理者を `/admin` にリダイレクト。サイドバーは管理者ログイン時にユーザーメニュー非表示。

#### 4. 既存ページ強化

- 交換履歴/ログセンター/リスク分析にCSVエクスポートボタン追加
- 薬局編集ページに監査ログタイムライン追加
- ログセンターのスクロール・幅修正（PageShell + ScrollArea適用）
- ダッシュボードにクイックリンク14個追加

#### 5. コード品質改善

- DBクエリ並列化（`Promise.all`）: 通知統計・薬局ヘルス・品質サマリー・マッチング性能
- CSVエクスポート共通ハンドラー化（~60行削減）
- サイドバー `useSubgroupState` hook統合（~40行削減）
- `bulkResolveAlerts` を `inArray()` に変更（型安全性向上）
- badge key の型安全化、監査ログ `.limit(100)` 追加

---

## [0.0.12] - 2026-03-16

### テーマ: WorkOS AuthKit認証移行・医薬品マスター強化・動画生成基盤

**認証基盤をWorkOS AuthKitに全面移行し、セキュリティと利便性が向上。医薬品マスターの自動同期・包装単位マッチングを追加。プロダクト紹介動画の自動生成基盤（Remotion）も導入。**

---

#### 1. 認証をWorkOS AuthKitに全面移行

**今まで**: 認証はパスワード＋自前JWT方式でした。パスワードリセットのメール送信基盤が未実装で、新規ユーザーのオンボーディングフローも不完全。セッション管理も独自実装のため、SSO対応やMFA追加が困難でした。

**今後**: WorkOS AuthKitに完全移行しました。ログイン・新規登録はWorkOSのホスト型UIにリダイレクトされ、OAuth2.0フローでセキュアに認証されます。既存ユーザーはメールアドレスで自動リンク。新規ユーザーはオンボーディングページで薬局情報を入力後にアカウントが有効化されます。

```
ログイン → WorkOS AuthKit UI → コールバック → JWT発行
新規登録 → WorkOS → オンボーディング → 薬局登録 → 有効化
```

- WorkOS CLI でリダイレクトURI・CORS・ホームページURLを設定済み
- セキュリティレビュー指摘事項をすべて対応済み

#### 2. 医薬品マスターの自動同期と包装単位対応

**今まで**: 医薬品マスターデータは手動でのインポートが必要で、包装形態（錠・カプセル・mg等）の違いによるマッチングミスが頻発していました。新しい薬が追加されても自動で反映されませんでした。

**今後**: HOTコード検索と自動同期機能を追加。厚労省の薬価基準データから包装単位を自動抽出し、マッチング時の包装形態互換性チェックが可能になりました。

- HOTマスター自動同期: 変更検知による差分更新
- MEDIS medhot包装単位CSVパーサー（17テストケース）
- 医薬品マスターカバレッジ改善（A+B+C戦略）
- 単位抽出の全薬品カテゴリ対応
- アップロード時のマスター紐付けチェック＋候補提案

#### 3. マッチングロジックの精度向上

**今まで**: 包装形態の違い（錠剤 vs カプセル、10mg vs 20mg）がマッチングスコアに反映されず、実際には交換できない組み合わせが候補に上がることがありました。

**今後**: 包装形態の互換性チェックをマッチングロジックに統合。同一成分でも包装形態が異なる場合はスコアを適切に調整します。アップロード時に必須フィールドのガイドとバリデーション警告も追加。

#### 4. セキュリティ強化

**今まで**: `.env` ファイルが `.gitignore` に含まれておらず、機密情報がリポジトリにコミットされるリスクがありました。カメラ機能のモバイル対応でCSPヘッダーが不足していました。

**今後**: `.env` を `.gitignore` に追加し機密情報を保護。`Permissions-Policy` ヘッダーと CSP `media-src` を追加しモバイルカメラに対応。ハーネスレビューで指摘された重大なセキュリティ問題をすべて修正済み。

#### 5. コード品質の改善

**今まで**: レビューで指摘された10件の改善点が未対応でした。

**今後**: リファクタリングを実施し、コードの可読性・保守性を向上。レビュー指摘事項を全件対応済み。

#### 6. プロダクト紹介動画の自動生成基盤（Remotion）

**今まで**: プロダクト紹介動画の作成手段がなく、外部ツールや手作業に依存していました。

**今後**: Remotionフレームワークを導入し、コードベースからプロダクト紹介動画を自動生成できるようになりました。90秒の7シーン構成ティーザー動画が `npm run remotion:render` で生成可能です。

```
npm run remotion        # Remotion Studio でプレビュー
npm run remotion:render # 90秒動画を out/video.mp4 に出力
```

シーン構成:
| シーン | 内容 |
|--------|------|
| Hook | 「その在庫、捨てる前に」 |
| Problem+Promise | デッドストック問題 → 解決 |
| Upload Demo | アップロード画面 |
| Matching Demo | マッチング候補表示 |
| Dashboard | 統計ダッシュボード |
| Differentiator | 数字で示す信頼性 |
| CTA | 行動喚起 |

---

## [0.0.11] - 2026-03-16

### テーマ: 開発者ログインの本番対応・ビルド高速化・CI刷新

**テスト薬局でのワンクリックログインが本番環境でも使えるようになりました。CIは4倍速く、デプロイも軽量化。**

---

#### 1. テスト薬局ログインが本番で使えるように

**今まで**: ログインページの「開発者ログイン」からテスト薬局を選んでも、500エラーが出てログインできませんでした。テスト薬局のパスワードも表示されず、手入力が必要でした。

**今後**: 5つのテスト薬局（東京・大阪・愛知・福岡・北海道）がデプロイ時に自動登録されます。「一覧から選ぶ」でテスト薬局を選択すると、メールアドレスとパスワードがワンクリックで入力されます。

| テスト薬局 | 地域 |
|-----------|------|
| テスト薬局A | 東京都 |
| テスト薬局B | 大阪府 |
| テスト薬局C | 愛知県 |
| テスト薬局D | 福岡県 |
| テスト薬局E | 北海道 |

#### 2. CIが並列実行で高速化

**今まで**: CIは全ステップが直列実行。lint → typecheck → テスト → ビルドを1つのジョブで順番に処理していたため、1箇所の失敗でも全体が遅延していました。

**今後**: lint-typecheck / server テスト / client テスト / 統合テストの4ジョブが同時に走ります。全部通った後にビルド検証が実行されます。README にCIバッジも追加しました。

#### 3. クライアントビルドが高速化 (SWC)

**今まで**: Vite の React プラグインに Babel を使用。JavaScript ベースの変換で、ビルドのたびに数秒の待ち時間がありました。

**今後**: Rust ベースの SWC に切り替え。JSX/TSX の変換が 2〜3 倍速くなりました。

#### 4. 認証エラー (500) の解消

**今まで**: `/api/auth/me` や `/api/auth/test-pharmacies` にアクセスすると 500 エラー。原因は `express-rate-limit` v8 がモジュール読み込み時にエラーをスローし、認証関連の全機能が停止していました。

**今後**: 不要なカスタム設定を削除して修正。認証エンドポイントが正常に動作します。

#### 5. コードベースの大規模整理

**今まで**: `schema.ts` に全テーブル定義が集中 (1000行超)。サービスファイルも巨大で、変更時の影響が把握しにくい状態でした。

**今後**: スキーマを9ファイル、サービスを10以上のヘルパーに分割。コードレビューと保守が容易になりました。テストは4593件すべてパスしています。

---

## [0.0.10] - 2026-03-09

### Added

- **グループ機能**: 薬局グループの作成・管理・メンバー招待機能（GroupListPage, GroupDetailPage, group-service, group-routes）
- **グループアラート**: グループ内の在庫アラート表示・フィルタ・通知（AlertListPage, alerts-route, alert-read-service）
- **PWA対応**: Service Worker（sw.ts）、オフラインページ、manifest.json、インストールプロンプト（InstallPromptBanner）、SW更新通知（SWUpdateBanner）
- **プッシュ通知**: Web Push購読管理（usePushSubscription）、プッシュ通知設定UI（PushNotificationSettings）、プッシュ許可バナー（PushPermissionBanner）、サーバー側push-dispatch-service・push-routes
- **マッチングスコア改善**: ランカーエンジン、同等性ボーナス、有効期限減衰、グループボーナス、成功率スコアの各スコアリングモジュール追加
- **医薬品同等性管理**: 医薬品同等性の管理者ページ・サービス・APIルート追加
- **マッチングルール管理**: マッチングルールの管理者設定ページ追加
- **Sentry→OpenClaw自動修正連携**: Sentryエラーを検知しOpenClaw経由で自動修正を実行する統合パイプライン（T213-T217）、openclaw-error-autofix-service、error-fix-context
- **CSVエクスポートレート制限**: CSVエクスポートエンドポイントへのレート制限追加（admin-csv-export-route）
- **CSVファイルサイズ・行数制限**: DoS防止のためのCSVアップロードサイズ・行数バリデーション
- **カメラ撮影コンポーネント分割**: CameraViewport、DraftRowList、ScanResultSheet に分割、useCamera・useCameraDraftRows・useBarcodeResolver フック抽出
- **フロントエンドフック大量抽出**: useUploadJobPolling（T128）、useUploadForm、useUploadPreview、useDiffPreview、useDiffSummary、useUploadExcelFlow、useAccountForm、useAdminPharmacyEdit、useBusinessHoursForm、useNotificationSettings、useAutoSave、useSWUpdate
- **営業時間設定コンポーネント分割**: RegularHoursSection、SpecialHoursSection に分割
- **モバイルボトムナビ**: MobileBottomNav コンポーネント追加
- **インフラ・DX改善スプリント（T201-T212）**: Dependabot設定、Lighthouse CI、husky commit-msg/pre-commit フック、Sentry設定（client/server）
- **タイプ定義追加**: admin.ts、alert.ts、group.ts、push.ts、timeline.ts の型ファイル新設
- **ユーティリティ追加**: api-error.ts（構造化APIエラー）、email-utils.ts、error-utils.ts、type-guards.ts、validators.ts
- **ルート補助モジュール**: auth-helpers.ts、notifications-helpers.ts、response-helpers.ts、admin-pharmacies-detail-helpers.ts
- **エラーメッセージ・バリデーション定数**: errorMessages.ts、validationMessages.ts、constants/index.ts
- **LoadingOverlay**: ローディングオーバーレイUIコンポーネント
- **AppTouchInput**: タッチ操作対応入力コンポーネント
- **テスト大幅追加（40+ファイル）**: group-routes、group-service、alert-routes、alert-read-service、alert-push-integration、push-routes、push-subscription-service、push-dispatch-service、matching-ranker、matching-score-*（4ファイル）、drug-equivalence-service、admin-drug-equivalences-route、admin-matching-rules-validation、openclaw-error-autofix-service、error-fix-context、camera-dead-stock-service、compute-optimal-batch-size、csrf-middleware、csv-export-service、error-handler-middleware、health-endpoint、monitoring-kpi-alert-scheduler、request-logger-middleware、security-headers、sentry、upload-middleware、api-error、audit-log-service、exchange-proposals-timeline、timeline-aggregators、DashboardTimeline、ProposalTimeline、SmartDigest、TimelineEventCard、TimelineContext、AuthContext、useBarcodeResolver、useCamera、useCameraDraftRows、useDiffPreview、useDiffSummary、useUploadForm、useUploadJobPolling、useUploadPreview、usePushSubscription、InstallPromptBanner、MobileBottomNav、PushNotificationSettings、PushPermissionBanner、SWUpdateBanner、sw、AlertListPage、group-detail-page、group-list-page、matching-page-groups、pharmacy-list-groups、admin-exchanges-page-mobile、admin-logs-page-mobile、admin-upload-jobs-page-mobile

### Fixed

- **レスポンシブ対応**: GroupDetail、AlertList、Dashboard のモバイルビューポート修正
- **テストログイン復元**: テストログイン自動入力と単一カラムレイアウトの復元
- **テスト薬局パスワード**: テストモード有効時のパスワード返却を修正
- **Vercelインストール**: Vercelインストール時のhusky スキップ対応（VERCEL環境変数検出）
- **テストアカウントセキュリティ**: テストアカウントの平文パスワード永続化・露出を停止
- **本番テストログイン無効化**: Vercel本番環境でのテストログインをデフォルト無効に変更
- **ESLint警告抑制**: cleanup useEffect の exhaustive-deps 警告を修正
- **ログインリダイレクトテスト**: 正しいセレクタを使用するよう修正
- **自動スキャン**: safe autofix の適用（3件: 2026-03-06 14:16, 2026-03-07 04:13, 2026-03-07 06:18 JST）

### Changed

- **サーバーリファクタリング Wave 4-6**: exchange-comments・exchange-service の共通ヘルパー抽出、isRecord 共有型ガード・Zodスキーマ修正
- **フロントエンドリファクタリング Wave 4**: UploadPage・AccountPage からカスタムフックを抽出し責務分離
- **OpenClawハンドオフ統合**: 共有ハンドオフエグゼキュータの抽出・ユーティリティ重複排除
- **ハンドオフメッセージ改善**: ハンドオフメッセージング、ヘルスステータス表示、差分プレビュー中断処理の改善
- **Sentry統合簡素化**: Sentryインテグレーションとチャンク分割の簡素化
- **アップロードパフォーマンス**: 動的バッチサイズ調整（compute-optimal-batch-size）、detectHeaderRow の早期終了最適化（T218, T219）
- **Phase 7 コード簡素化**: レビュー後のPhase 7コードリファクタリング
- **CameraDeadStockRegisterPanel**: 1,391行→コンポーネント・フック分割で大幅簡素化
- **BusinessHoursSettings**: サブコンポーネント分割とフック抽出で可読性向上
- **AdminPharmacyEditPage**: useAdminPharmacyEdit フック抽出で658行のロジック分離
- **ProposalDetailPage**: ProposalTimeline・TimelineEventCard の大幅改善（643行差分）
- **タイムラインコンポーネント**: DashboardTimeline、SmartDigest の改善
- **管理画面改善**: AdminLogCenterPage（345行差分）、AdminPharmaciesPage、AdminDashboardPage の強化
- **ルート設定拡張**: 12ルート追加（グループ、アラート、PWA関連）
- **CI設定更新**: ci.yml 修正、Lighthouse CI ワークフロー追加
- **vercel.json**: 20行のルーティング設定追加

## [0.0.9] - 2026-03-06

### Added

- **カメラデッドストック登録**: カメラ撮影によるデッドストック一括登録フロー（CameraDeadStockRegisterPanel 1,202行）、GS1バーコードパーサー、サーバー側 camera-dead-stock-service
- **サインインフロー刷新**: ログイン画面を再設計しシンプル化、テストログインのゲート制御（testLoginFeature）、環境別フィーチャーフラグ対応
- **ErrorBoundary**: クライアント全体のエラー境界コンポーネント、ErrorRetryAlert による再試行UI
- **デッドストック取込改善**: アップロードページの取込フロー安定化、CSV行長セキュリティチェック追加
- **テスト大幅追加**: inventory-route（335行）、scheduler-runtime-branch（235行）、admin-pharmacies-list-extra（141行）、logger-branches（144行）、drug-master-source-state-service-extra（121行）、test-pharmacy-schema（91行）、gs1-parser（57行）、test-login-feature-config（46行）、csv-line-length-security（37行）等の新規テスト
- **デザインシステム拡張**: design-language.css（286行追加）、モバイル向けスタイル強化
- **proposal-status ユーティリティ**: proposalStatusStyle のカバレッジを95%基準に到達

### Fixed

- **テスト薬局プレビュー**: Vercel preview 環境でのテスト薬局プレビュー表示を修正（2件）
- **タイムゾーン対応**: toJstDate のタイムゾーン非依存化、23:00 JST テストの UTC 明示化でCI互換性を確保
- **自動スキャン**: safe autofix の適用（2件）
- **エラーハンドラ**: error-handler ミドルウェアの改善
- **テストアカウントパスワード**: preview 環境でのテストアカウントパスワード返却を修正

### Changed

- **サーバー大規模リファクタリング**: auth.ts、exchange-proposals.ts、notifications.ts、matching-service.ts、upload-diff-service.ts、upload-confirm-service.ts 等の主要サービス・ルートを整理・最適化（計 6,000行以上の差分）
- **ホットパス最適化**: codex repo 設定の除去、不要な処理パスの簡略化
- **usePaginatedList**: キャッシュ処理の簡略化、過剰な useMemo を除去
- **共通ユーティリティ抽出**: parseTimestamp 抽出、LOG_SOURCE_VALUES 重複除去
- **ページコンポーネント改善**: LoginPage（535行→簡略化）、MatchingPage、StatisticsPage、UploadPage、ProposalDetailPage 等の UI 改善
- **PGlite統合テスト基盤**: test-db.ts のスナップショットDDL生成を168行拡張
- **network-utils**: 100行の改善、request-utils にユーティリティ追加
- **migrate-legacy**: レガシーマイグレーション処理の簡略化（135行削減）

## [0.0.7] - 2026-03-02

### 🎯 What's Changed for You

**統合ログセンターとOpenClawコマンド管理で運用監視を強化。コード品質の大幅改善**

| Before | After |
|--------|-------|
| ログは各テーブルを個別に確認 | 統合ログセンター（4ソース横断検索・フィルタ） |
| エラーコードなし | 14種の構造化エラーコード（カテゴリ・重要度付き） |
| OpenClawコマンドは手動実行のみ | HMAC認証付きコマンド受信API + 管理者履歴表示 |
| スケジューラに重複ロジック | 共通モジュール化（mhlw-source-fetch等） |

### Added

- **統合ログセンター**: activity_logs / system_events / drug_master_sync_logs / openclaw_commands の4テーブルを横断する統合ログビュー、レベル・ソース・薬局フィルタ、サマリーAPI
- **エラーコード管理**: error_codes テーブル、14種の初期コード（upload/auth/sync/system/openclaw）、管理者CRUD API
- **OpenClawコマンド受信**: HMAC署名検証付きコマンドAPI、ホワイトリスト方式の実行制御、管理者向けコマンド履歴タブ
- **ログアラート転送**: OpenClawゲートウェイへのバッファ付きバッチ送信サービス
- **MHLWソース状態管理**: drug_master_source_state テーブルで更新チェック状態を永続化、ETag/Last-Modified/content-hash による差分検知

### Fixed

- **タイムラインソート安定化**: cursor pagination のソート順安定性を修正
- **アップロードジョブ処理**: 設定されたリトライバッチサイズまで処理するよう修正
- **OpenClaw IPv6対応**: localhost の IPv6 ベースURL を許可
- **自動スキャン**: safe autofix の適用（6件）

### Changed

- **スケジューラ共通化**: drug-master-scheduler / drug-package-scheduler の更新チェック・ダウンロードロジックを mhlw-source-fetch.ts に統合
- **コード品質改善**: getErrorMessageOrFallback 除去、previewDetail 共通ユーティリティ化、normalizeSearchTerm 統一、useMemo 最適化、AdminSystemEventsPage デッドコード削除（244行）

## [0.0.6] - 2026-03-01

### 🎯 What's Changed for You

**薬局登録時の本人確認フローを追加。OpenClaw連携による自動検証を実現**

| Before | After |
|--------|-------|
| 薬局登録即利用可能 | 登録→本人確認→承認の3ステップフロー |
| 管理者の手動確認のみ | OpenClaw連携による自動検証 + 管理者手動承認 |
| 確認状態の表示なし | ログイン時の状態チェック + 確認待ちページ |

### Added

- **薬局本人確認フロー**: 登録→pending_verification→verified/rejected の状態遷移
- **OpenClaw検証連携**: 登録時にOpenClawへ自動ハンドオフ、コールバックで結果受信
- **管理者手動承認**: 管理者画面から確認状態の表示・手動承認操作
- **確認待ちページ**: 登録後のリダイレクト先、状態に応じた案内表示
- **認証ミドルウェア強化**: ログイン時の確認状態チェック

### Fixed

- **タイムラインUI**: ダッシュボードタイムラインにカードボーダーを追加

### Changed

- **エラーハンドリング整理**: 不要なヘルパー関数の削除
- **レビュー指摘対応**: exchange/statistics/upload の品質改善

## [0.0.5] - 2026-03-01

### 🎯 What's Changed for You

**統合タイムラインでダッシュボードを刷新。朝開いたら全部わかる体験を実現**

| Before | After |
|--------|-------|
| 通知ベースの個別表示 | 9テーブル統合タイムライン（優先度ランク付き） |
| ダッシュボードはスクロール必須 | PC画面にフィットするビューポートレイアウト |
| ログイン→表示まで約7秒 | API並列化+キャッシュで高速化 |
| 運用監視なし | KPIモニタリング・予測アラート・取込ジョブ管理 |

### Added

- **統合タイムライン**: 9テーブルから集約したイベントフィード、Critical/High/Medium/Low 4段階優先度エンジン、SmartDigest（今日のアクション）、優先度フィルタ付きタイムラインビュー（97テスト）
- **運用管理機能群**: 取込ジョブ管理、システムイベント、KPIモニタリング、予測アラート、マッチングルール管理
- **ダッシュボードPC画面フィット**: 2カラムトップ（SmartDigest+リスクKPI）+ タイムライン（flex-grow内部スクロール）でスクロール不要

### Fixed

- **セキュリティ**: fast-xml-parser の脆弱性修正（audit finding 対応）
- **自動スキャン**: safe autofix の適用

### Changed

- **ダッシュボード表示高速化**: `/notifications` クエリ並列化、リスクAPI 30秒キャッシュ、AuthContext 二重取得除去、NotificationContext 統合
- **運用ドキュメント整備**: hourly scan 設定、isolated subagent review mode 文書化

## [0.0.4] - 2026-02-28

### 🎯 What's Changed for You

**提案タイムライン・アップロード確認ワークフロー・セキュリティ強化の大型アップデート**

| Before | After |
|--------|-------|
| 提案の経緯が不明 | アクター・操作ごとのタイムライン表示で経緯が一目瞭然 |
| アップロード即反映で誤操作リスク | 差分プレビュー→確認→反映の3ステップ確認ワークフロー |
| エラーメッセージに内部情報が漏れる可能性 | 本番環境ではエラー詳細をサニタイズ、CSP/CSRF対策も強化 |
| バージョン表示なし | タイトル横にアプリバージョンを常時表示 |

### Added

- **提案タイムライン**: 提案の状態遷移をアクター・操作・日時で時系列表示
- **タイムラインフィルター**: 管理者向け全タイムライン閲覧・絞り込み機能
- **アップロード確認ワークフロー**: 差分プレビュー→確認→反映の3ステップで誤操作を防止
- **OpenClaw Gateway CLI モード**: OpenClaw コネクタにゲートウェイCLIモードを追加
- **管理者アラートサマリ**: アップロード失敗・未処理ジョブの要約表示

### Fixed

- **バージョン表示**: ヘッダーとログイン画面のタイトル横にアプリバージョンを表示
- **セキュリティ強化**: エラーメッセージのサニタイズ、CSP ヘッダー追加、CSRF/内部認証のタイミングセーフ比較
- **テスト薬局プレビュー**: プレビュー環境でのデフォルト動作を復元
- **テスト基盤改善**: Node 25+ 環境の localStorage 互換性修正

### Changed

- **コードリファクタリング**: exchange.ts と admin-pharmacies.ts をサブルートモジュールに分割
- **パフォーマンス改善**: マッチングリフレッシュのN+1クエリ解消、複合インデックス追加
- **ステータスラベル日本語化**: 提案の承認/拒否ステータスをユーザー視点の日本語表記に統一

## [0.0.3] - 2026-02-28

### 🎯 What's Changed for You

**通知センター・テストアカウント基盤・UIコンポーネントライブラリの追加**

| Before | After |
|--------|-------|
| 通知機能なし | 統合通知センター（リアルタイム既読管理付き） |
| テストアカウントはハードコード | DB 駆動の is_test_account フラグで一元管理 |
| ページごとに個別UI実装 | 再利用可能なUIコンポーネントライブラリ (AppField, AppSelect 等) |
| 管理画面は薬局一覧のみ | 管理者向け薬局編集・月次レポート・リスク管理画面追加 |

### Added

- **通知センター**: notifications テーブル、NotificationService、通知API 5エンドポイント、フロントエンド NotificationContext
- **テストアカウント基盤**: is_test_account フラグ、DB 駆動のテスト薬局シード、テスト薬局ピッカーUI
- **UIコンポーネントライブラリ**: AppField, AppSelect, AppCard, AppAlert, AppEmptyState, PageLoader, LoadingButton 等 16コンポーネント
- **管理者薬局編集ページ**: AdminPharmacyEditPage（652行）で薬局情報の詳細編集が可能に
- **月次レポート機能**: MonthlyReportService、スケジューラ、管理者レポートページ
- **信頼スコアサービス**: TrustScoreService で薬局の信頼度を評価
- **期限切れリスクサービス**: ExpiryRiskService で在庫の期限切れリスクを分析
- **アップロード差分サービス**: UploadDiffService で在庫アップロード時の差分検出
- **提案優先度サービス**: ProposalPriorityService で提案の優先順位付け
- **デザインシステム**: medical-ui-design-language.css (608行)、generic-design-presets
- **楽観的ロック**: optimistic lock versions による同時編集の競合防止
- **新規テスト 20+件**: auth, notifications, exchange, inventory, pharmacies, trust-score, upload-diff, monthly-report 等
- **デモログイン改善**: 個別デモ資格情報、ロールベース薬局編集UX

### Fixed

- **通知 referenceId**: new_comment 通知で commentId ではなく proposalId を使用するよう修正
- **認証フロー強化**: ログイン/セッションフローのハードニング、本番環境ガード
- **テスト薬局プレビュー**: アカウントサイズに連動した表示件数制御
- **Drizzle マイグレーション**: 繰り返し実行時のべき等性を確保
- **テストアカウントパスワード**: ワンクリックログイン用のデフォルトパスワードフォールバック復元
- **テスト薬局フォールバック**: test フラグ欠損時に DB のテスト風薬局へフォールバック

### Changed

- **テスト薬局一覧**: is_test_account のみでシンプルに判定するようリファクタリング
- **認証リファクタリング**: デモログイン・シードの成果物を整理・削除
- **ESLint 設定**: eslint.config.mjs 追加（monorepo 対応）

## [0.0.2] - 2026-02-26

### 🎯 What's Changed for You

**コードベースの大規模モジュール分割とマッチング基盤強化**

| Before | After |
|--------|-------|
| 巨大な単一ファイル (admin.ts 700行, drug-master.ts 700行等) | 責務別に分割された小モジュール群 |
| マッチング結果は毎回フル計算 | スナップショット・リフレッシュジョブによる差分更新基盤 |
| マッチング通知なし | match_notifications テーブルで新規候補を通知可能に |

### Changed

- **モジュール分割**: server routes (admin, drug-master, upload) と services (drug-master, matching) を責務別に分割
- **クライアント分割**: AccountPage, DashboardPage, AdminDrugMasterPage を小コンポーネントに分解
- **CSS分割**: app.css をセクション別 (header, layout-sidebar, content, mobile) に分離
- **ルート定義抽出**: App.tsx から route-config.tsx に分離

### Added

- **マッチング予約**: dead_stock_reservations テーブルで提案中在庫の二重マッチを防止
- **マッチングスナップショット**: match_candidate_snapshots テーブルで候補状態を保持
- **マッチング通知**: match_notifications テーブルとリアルタイム通知基盤
- **リフレッシュジョブキュー**: matching_refresh_jobs テーブルとリトライ・排他制御
- **pg_trgm インデックス**: 医薬品名・ジェネリック名・ログ詳細のあいまい検索高速化
- **useAsyncResource フック**: 非同期リソース取得の共通化
- **新規テスト**: exchange-service, matching-refresh, matching-snapshot, notifications-route, http-utils, network-utils, dashboard, routes-meta, business-hours-settings

## [0.0.1] - 2026-02-25

### 🎯 What's Changed for You

**薬局向けデッドストック管理システムの初回リリース**

| Before | After |
|--------|-------|
| 未提供 | 薬局デッドストック管理システム |
| 薬局間の手動在庫管理 | 仮マッチング → 確定 → 完了の自動ワークフロー |
| 薬価参照なし | 厚労省医薬品マスター自動同期 (Excel/CSV) |

### Added

- **医薬品マスター管理**: MHLW データ取得・パース・同期・検索、管理者UI
- **在庫マッチング**: 3フェーズワークフロー、薬局お気に入り/ブロック機能
- **OpenClaw連携**: コールバック処理、自動ハンドオフ、ログコンテキスト
- **GitHub Updates API**: `/api/updates` エンドポイント
- **取り込み失敗アラート**: インポート失敗の定期監視
- **モバイルUI改善**: ヘッダークイックリンク、ユーザーリクエストボタン
- **E2Eテスト**: ダッシュボード、ログイン、在庫、提案、登録フロー
- **可観測性**: リクエストロガー、フィーチャーフラグ付き構造化ログ

### Fixed

- Vercel preview でのデモアカウントシード/パスワードフォールバック
- デモログイン資格情報の自動入力
- Preview DB同期とテストアカウントパスワード更新
- 本番環境でのCORS同一ホストオリジンチェック

[0.0.13]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.12...v0.0.13
[0.0.12]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.11...v0.0.12
[0.0.11]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.10...v0.0.11
[0.0.10]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.9...v0.0.10
[0.0.9]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.8...v0.0.9
[0.0.7]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/yusuketakuma/DeadStockSolution/commits/v0.0.1
