# DeadStockSolution

[![CI](https://github.com/yusuketakuma/DeadStockSolution/actions/workflows/ci.yml/badge.svg)](https://github.com/yusuketakuma/DeadStockSolution/actions/workflows/ci.yml)
[![Lighthouse CI](https://github.com/yusuketakuma/DeadStockSolution/actions/workflows/lighthouse.yml/badge.svg)](https://github.com/yusuketakuma/DeadStockSolution/actions/workflows/lighthouse.yml)
![Version](https://img.shields.io/badge/version-0.0.24-blue)
![Node](https://img.shields.io/badge/node-24.14.1-green)
![License](https://img.shields.io/badge/license-MIT-brightgreen)

**薬局間のデッドストック交換を自動化する業務システム**

在庫アップロード → AIマッチング → 提案・交渉 → 交換完了までをワンストップで管理。
滞留在庫の削減と廃棄損失の抑制を実現します。

🔗 **[dead-stock-solution.vercel.app](https://dead-stock-solution.vercel.app/)**

> **Preview 環境のご利用にあたって**
> デモ環境はプレビュー用途です。**実在する薬局名・患者情報・個人を特定できるデータは絶対に入力しないでください。**
> 入力されたデータは暗号化されますが、開発・検証目的でスタッフがアクセスする可能性があります。

<!-- TODO: スクリーンショットを追加
![ダッシュボード](docs/screenshots/dashboard.png)
-->

---

## このシステムが解決する課題

| 課題 | DeadStockSolution の解決策 |
|------|--------------------------|
| 期限が近い在庫を単独薬局内で処理しきれない | 他薬局とのマッチング候補を自動生成し、交換を促進 |
| 交換相手の探索が電話・FAX・メール頼み | 薬剤名類似度・期限・距離・相互解消効果でスコアリングし、最適な候補を提示 |
| 提案のステータス管理が分散し対応漏れが発生 | 提案→承認→確定→完了の一貫ワークフローで進捗を可視化 |
| 在庫リスクや交換実績を横断把握できない | 統計ダッシュボードでリスク・実績・傾向をリアルタイム集約 |

---

## 主要機能

### 在庫管理

- **Excel/CSVアップロード** — 非同期ジョブ処理でデッドストック/使用量データを一括登録。アップロード前にプレビュー画面でデータと列の対応を確認・手動修正が可能
- **カラムマッピング** — システムが自動推定した列マッピングをドロップダウンで修正可能。先頭5行のプレビューで実データを見ながら調整できる
- **差分反映** — replace / diff / partial 方式を選択可能、取り込み失敗行の確認にも対応
- **医薬品マスター連携** — 厚労省の薬価基準データ・PMDA包装単位データを自動取得。Vercel Cron Job により毎日深夜3時に自動同期
- **アップロード品質ダッシュボード** — 欠損率・重複率・マッピング成功率をメトリクスで可視化

### マッチング・交換

- **AIマッチング** — 薬剤名類似度・期限・距離・相互不動在庫解消効果を加味して候補を優先度付け
- **交換ワークフロー** — 提案作成 → 承認/拒否 → 確定 → 交換完了を一貫管理
- **提案テンプレート** — 完了済み提案をテンプレート保存し、次回の提案作成時に再利用
- **提案期限とリマインド** — 仮マッチングは72時間で失効。残り時間と「誰待ち」を一覧・詳細で表示
- **コメント・フィードバック** — 交換の追跡性を確保、信頼スコアの算出
- **マッチング実験** — 管理画面からA/Bパラメータを変えた実験を実行し、結果を比較

### 通知・ダッシュボード

- **タイムライン** — 未読数、重要イベント、ダイジェストを集約
- **統計ダッシュボード** — アップロード状況、在庫リスク、提案/交換実績を可視化
- **通知センター** — 未読・期限切迫・通知種別でフィルタリング可能な一覧画面
- **リアルタイムバッジ** — サイドバーとヘッダーに未対応件数をリアルタイム表示
- **マッチ通知トースト** — 新しいマッチ候補が見つかった際に即時通知

### 管理者パネル（16ページ）

- **薬局管理** — 薬局CRUD、グループ管理、薬局間リレーション管理、薬局ヘルス監視
- **運用管理** — アラート管理、監査ログ、エラーコード一覧、レート制限管理、営業時間設定
- **分析** — マッチング性能分析、マッチング実験、アップロード品質分析、月次レポート
- **ユーザー対応** — ユーザーリクエスト管理、一括操作（CSV）、通知管理
- **外部連携** — OpenClaw/DDS連携管理（retry queue、bootstrap token、イベントタイムライン）

---

## デモ環境

🔗 **https://dead-stock-solution.vercel.app/**

> **個人情報に関する注意事項**
> このデモ環境はプレビュー・検証用途です。
> - **実在する薬局名・患者名・個人を特定できる情報は入力しないでください**
> - 入力データは開発チームが検証目的で閲覧する可能性があります
> - データは定期的にリセットされる場合があります
> - テスト用の架空データのみをご使用ください

### テストログイン

デモ環境では **テストログイン機能** が有効です。ログイン画面下部の「テストアカウントでログイン」ボタンを押すと、5つのテスト薬局アカウントが表示されます。パスワード入力なしですぐに操作を試せます。

| アカウント種別 | 説明 | アクセス範囲 |
|--------------|------|-------------|
| テスト薬局 A〜D | 一般薬局ユーザー | 在庫管理、マッチング、提案、通知 |
| 管理者 | システム管理者 | 上記 + 管理者パネル全16ページ |

### 基本操作ガイド

#### 1. ログイン

ログイン画面 → 「テストアカウントでログイン」 → 任意のアカウントを選択

#### 2. 在庫アップロード

1. サイドバーから「アップロード」を選択
2. Excel/CSVファイルをドラッグ＆ドロップ（またはファイル選択）
3. プレビュー画面で列の対応を確認・修正
4. 「アップロード開始」で非同期ジョブが実行される
5. ジョブ完了後、登録件数と失敗行を確認

#### 3. マッチング候補の確認

1. サイドバーから「マッチング」を選択
2. 自動生成されたマッチング候補一覧を確認
3. スコア（類似度・期限・距離・相互解消効果）で優先度がソート済み
4. 候補を選択して「提案を作成」

#### 4. 交換提案の管理

1. 「提案一覧」から作成済みの提案を確認
2. 提案詳細でコメント追加・ステータス変更が可能
3. ワークフロー: 提案 → 相手方承認 → 確定 → 交換完了
4. 72時間以内に応答がない提案は自動失効

#### 5. 管理者パネル（管理者アカウントのみ）

サイドバーから「管理」セクションにアクセス。薬局管理、マッチングルール設定、アップロード品質確認、監査ログ閲覧などが可能。

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                        Vercel Edge Network                      │
├────────────────────────────┬────────────────────────────────────┤
│   Frontend (Vite + React)  │   Backend (Express 5 Serverless)   │
│                            │                                    │
│  ┌──────────┐ ┌─────────┐ │  ┌───────────┐  ┌──────────────┐  │
│  │  Pages   │ │ Context │ │  │  Routes   │  │  Middleware   │  │
│  │  (35+)   │ │ (Auth,  │ │  │  (31+)    │  │  JWT / CORS  │  │
│  │          │ │Timeline)│ │  │           │  │  Helmet/CSRF │  │
│  └────┬─────┘ └────┬────┘ │  └─────┬─────┘  └──────────────┘  │
│       │             │      │        │                           │
│  ┌────▼─────────────▼────┐ │  ┌─────▼─────┐  ┌──────────────┐ │
│  │   API Client (Axios)  │─┼──▶  Services  │  │  Cron Jobs   │ │
│  │   + Auth Interceptor  │ │  │  (Domain)  │  │  (日次同期)  │ │
│  └───────────────────────┘ │  └─────┬──────┘  └──────┬───────┘ │
│                            │        │                │          │
├────────────────────────────┤  ┌─────▼────────────────▼───────┐ │
│                            │  │      Drizzle ORM             │ │
│                            │  └─────────────┬────────────────┘ │
└────────────────────────────┴────────────────┼──────────────────┘
                                              │
                                    ┌─────────▼─────────┐
                                    │  Vercel Postgres   │
                                    │  (Neon)            │
                                    └─────────┬─────────┘
                                              │
                              ┌───────────────┼───────────────┐
                              │               │               │
                     ┌────────▼──┐   ┌────────▼──┐   ┌───────▼───┐
                     │  厚労省   │   │   PMDA    │   │ OpenClaw  │
                     │ 薬価基準  │   │ 添付文書  │   │  DDS API  │
                     └───────────┘   └───────────┘   └───────────┘
```

### データフロー

```
薬局ユーザー                          システム                           他薬局
    │                                   │                                │
    │  1. Excel/CSV アップロード        │                                │
    ├──────────────────────────────────▶│                                │
    │                                   │  2. 非同期ジョブで解析・登録   │
    │                                   │  3. 薬価マスターと突合         │
    │                                   │  4. マッチング候補自動生成     │
    │  5. マッチング候補一覧            │                                │
    │◀──────────────────────────────────┤                                │
    │                                   │                                │
    │  6. 交換提案を作成                │                                │
    ├──────────────────────────────────▶│  7. 相手方に通知               │
    │                                   ├───────────────────────────────▶│
    │                                   │                                │
    │                                   │  8. 承認/拒否                  │
    │                                   │◀───────────────────────────────┤
    │  9. ステータス更新通知            │                                │
    │◀──────────────────────────────────┤                                │
    │                                   │                                │
    │  10. 交換確定・完了               │                                │
    ├──────────────────────────────────▶│  11. 在庫数反映・履歴記録      │
```

---

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| **フロントエンド** | React 19 + TypeScript + Vite + React Bootstrap |
| **バックエンド** | Express 5 + TypeScript + Drizzle ORM |
| **データベース** | PostgreSQL (Vercel Postgres / Neon) |
| **認証** | WorkOS AuthKit (OAuth 2.0) + JWT |
| **デプロイ** | Vercel (Serverless Functions) |
| **モノレポ** | npm workspaces (`client/` + `server/`) |
| **テスト** | Vitest + Supertest + PGlite統合テスト |
| **CI/CD** | GitHub Actions + Lighthouse CI |

---

## セキュリティ

本システムでは多層的なセキュリティ対策を実装しています。

| 対策 | 実装 |
|------|------|
| **認証** | WorkOS AuthKit (OAuth 2.0) + JWT トークン |
| **CSRF 防御** | Double Submit Cookie パターン |
| **HTTP ヘッダー** | Helmet による Security Headers 自動付与 |
| **CORS** | 許可オリジンのホワイトリスト制御 |
| **レート制限** | エンドポイント単位のリクエスト制限（管理画面から調整可能） |
| **入力検証** | Zod スキーマによるリクエストボディ/パラメータ検証 |
| **機密情報マスク** | 管理画面のトークン表示はマスク化（先頭8文字 + 末尾4文字） |
| **Cron 認証** | `CRON_SECRET` ヘッダーによる Vercel Cron Job 認証 |
| **圧縮** | gzip/brotli レスポンス圧縮 |

---

## 外部データソース連携

本システムは厚生労働省および PMDA の公開データと連携しています。

| データソース | 更新頻度 | 用途 |
|-------------|---------|------|
| **厚労省 薬価基準収載品目リスト** | Cron で日次自動同期 | 薬品マスター、薬価単価の取得 |
| **PMDA 添付文書情報 XML** | 手動 or 管理画面から同期 | 包装単位マスターの取得 |
| **OpenClaw / DDS API** | リアルタイム | 外部薬品データベースとの連携 |

> 薬価マスターは Vercel Cron Job により毎日 JST 3:00 に自動更新されます。
> 手動同期は管理者パネルの OpenClaw 連携ページから実行できます。

---

## API 概要

主要な REST API エンドポイントです。全エンドポイントは `/api` プレフィックス配下です。

### 認証

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/auth/login` | ログイン（JWT 発行） |
| POST | `/auth/callback` | WorkOS OAuth コールバック |
| POST | `/auth/test-login` | テストアカウントログイン（preview のみ） |

### 在庫・アップロード

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/upload` | Excel/CSV ファイルアップロード |
| GET | `/upload/jobs` | アップロードジョブ一覧 |
| POST | `/upload/confirm` | アップロード確定処理 |
| GET | `/dead-stock` | デッドストック一覧 |
| GET | `/used-medications` | 使用量一覧 |

### マッチング・提案

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/matching` | マッチング候補一覧 |
| GET | `/exchange-proposals` | 提案一覧（ページネーション対応） |
| POST | `/exchange-proposals` | 提案作成 |
| PATCH | `/exchange-proposals/:id` | 提案ステータス更新 |
| GET | `/exchange-proposals/:id` | 提案詳細（並列クエリで高速取得） |

### 通知・タイムライン

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/notifications` | 通知一覧 |
| PATCH | `/notifications/read` | 既読処理 |
| GET | `/timeline` | タイムラインイベント集約 |

### 内部

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/internal/drug-master-sync` | 薬価マスター同期（Cron Job） |

---

## はじめかた

### 前提条件

- Node.js 24.14.1
- npm 11.11.1+
- PostgreSQL（ローカル or Neon/Vercel Postgres）

### セットアップ

```bash
# 1. クローン
git clone https://github.com/yusuketakuma/DeadStockSolution.git
cd DeadStockSolution

# 2. 依存インストール
npm install

# 3. 環境変数を設定
cp server/.env.example server/.env
# server/.env を編集し、DATABASE_URL と JWT_SECRET を設定

# 4. DBスキーマを反映
cd server && npx drizzle-kit push

# 5. 開発サーバー起動
cd .. && npm run dev:server   # バックエンド (localhost:3001)
npm run dev:client            # フロントエンド (localhost:5173)
```

---

## プロジェクト構成

```
DeadStockSolution/
├── client/                    # フロントエンド
│   └── src/
│       ├── pages/             # ルートページ
│       ├── components/        # 共通UIコンポーネント
│       ├── contexts/          # React Context (Auth, Timeline等)
│       ├── api/               # APIクライアント (Axios)
│       └── routes/            # ルート定義
├── server/                    # バックエンド
│   └── src/
│       ├── routes/            # Express ルートハンドラ (31+)
│       ├── services/          # ビジネスロジック層
│       ├── db/                # Drizzle ORMスキーマ (13ファイル)
│       ├── middleware/        # 認証・CSRF・エラーハンドリング
│       └── test/              # テスト (280ファイル, 4,592テスト)
├── docs/                      # ドキュメント
├── scripts/                   # 運用・検証・OpenAPI 補助スクリプト
├── dev/                       # Playwright / Remotion / fixture 類の開発補助資産
├── .codex/                    # repo 共有の Codex ルール
├── vercel.json                # Vercel設定
└── package.json               # ルート (npm workspaces)
```

### ローカル生成物の扱い

- `artifacts/`, `audits/`, `reports/`, `memory/` は実行時に再生成されるローカル成果物として扱い、Git には載せない
- `.claude/state/`, `.claude/sessions/`, `client/.claude/`, `server/.claude/` などの agent state もローカル専用
- 共有すべき設定は `.codex/`, `docs/`, `scripts/`, `AGENTS.md` 側へ寄せる

---

## テスト

```bash
npm run test              # 全テスト（server + client）
npm run test:server       # サーバー full suite
npm run test:client       # クライアントテストのみ
npm run test:integration:server  # PGlite統合テスト
npm run test:perf:server  # パフォーマンス退行チェック
npm run test:coverage     # カバレッジレポート
```

## 品質ゲート

```bash
npm run verify:preview    # preview に載せる前の必須 gate
npm run verify:release    # release candidate + smoke まで含む最終 gate
```

`verify:preview` には server/client full suite に加えて integration / perf / OpenAPI contract も含まれる。

release 判定時の基本形:

```bash
RELEASE_SMOKE_BASE_URL=https://<release-candidate>.vercel.app \
RELEASE_PROTECTION_BYPASS=<vercel_automation_bypass_secret> \
npm run verify:release
```

deployment 疎通だけ確認する場合:

```bash
SMOKE_BASE_URL=https://<preview-deployment>.vercel.app npm run smoke:preview
```

CI では `VERCEL_TOKEN` と `GITHUB_SHA` / `GITHUB_REF_NAME` から最新 preview deployment を自動解決できる。手元では share URL か branch-specific URL を `SMOKE_BASE_URL` に渡してもよい。

GitHub Actions で token 自動解決を使わない場合は、repository variable `PREVIEW_BRANCH_SMOKE_BASE_URL` に branch-specific URL を設定する。

詳細は [docs/operations/release-quality-gate.md](docs/operations/release-quality-gate.md) を参照。

---

## 画面一覧

### 一般ユーザー向け

| 画面 | パス | 説明 |
|------|------|------|
| ダッシュボード | `/` | 在庫リスク・提案状況・通知サマリー |
| デッドストック一覧 | `/dead-stock` | 自薬局の滞留在庫リスト |
| 使用量一覧 | `/used-medication` | 使用量データの閲覧 |
| アップロード | `/upload` | Excel/CSVアップロード＆カラムマッピング |
| アップロード品質 | `/upload-quality` | アップロードデータの品質メトリクス |
| マッチング | `/matching` | AIマッチング候補一覧 |
| 在庫ブラウズ | `/inventory` | 全薬局の在庫を横断検索 |
| 提案一覧 | `/proposals` | 交換提案の管理 |
| 提案詳細 | `/proposals/:id` | コメント・承認・ステータス管理 |
| 交換履歴 | `/exchange-history` | 完了済み交換の履歴 |
| ブックマーク | `/bookmarks` | 保存したマッチング候補 |
| 通知 | `/notifications` | 未読・種別フィルタ付き通知一覧 |
| メッセージ | `/messages` | 薬局間メッセージ |
| アカウント | `/account` | プロフィール・サブスク管理 |

### 管理者向け

| 画面 | パス | 説明 |
|------|------|------|
| 管理ダッシュボード | `/admin` | 運用状況の概要 |
| 薬局管理 | `/admin/pharmacies` | 薬局CRUD・編集・ヘルス監視 |
| グループ管理 | `/admin/groups` | 薬局グループの管理 |
| リレーション管理 | `/admin/relationships` | 薬局間の関係性管理 |
| アラート管理 | `/admin/alerts` | システムアラートの設定・確認 |
| 通知管理 | `/admin/notifications` | プッシュ通知の管理 |
| マッチングルール | `/admin/matching-rules` | マッチングパラメータの調整 |
| マッチング実験 | `/admin/matching-experiments` | A/B実験の作成・比較 |
| マッチング性能 | `/admin/matching-performance` | マッチング精度の分析 |
| アップロードジョブ | `/admin/upload-jobs` | アップロードジョブの監視 |
| アップロード品質 | `/admin/upload-quality` | データ品質の統計分析 |
| 監査ログ | `/admin/audit` | 操作ログの閲覧 |
| ログセンター | `/admin/log-center` | システムログの検索・分析 |
| ユーザーリクエスト | `/admin/user-requests` | ユーザーからの問い合わせ管理 |
| 一括操作 | `/admin/bulk-actions` | CSV一括インポート/エクスポート |
| レート制限 | `/admin/rate-limits` | API レート制限の設定 |
| エラーコード | `/admin/error-codes` | エラーコード一覧・検索 |
| 営業時間設定 | `/admin/business-hours` | 営業時間の管理 |
| 月次レポート | `/admin/monthly-reports` | 月次集計レポート |
| 薬品同等性 | `/admin/drug-equivalences` | 薬品同等性マスターの管理 |
| OpenClaw連携 | `/admin/openclaw` | 外部API連携・retry queue管理 |

---

## デプロイ

Vercel で自動デプロイ:

- **`main` ブランチ** → 本番環境
- **`preview` ブランチ** → プレビュー環境
- その他のブランチでは自動デプロイ無効

```bash
npm run deploy:preview    # preview ブランチのみ
npm run deploy:prod       # main ブランチのみ
```

---

## 環境変数

主要な環境変数の一覧です。詳細は `server/.env.example` を参照してください。

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `DATABASE_URL` | Yes | PostgreSQL 接続文字列 |
| `JWT_SECRET` | Yes | JWT トークン署名用シークレット |
| `WORKOS_API_KEY` | Yes | WorkOS AuthKit API キー |
| `WORKOS_CLIENT_ID` | Yes | WorkOS クライアント ID |
| `CRON_SECRET` | Yes | Vercel Cron Job 認証トークン |
| `DRUG_PACKAGE_SOURCE_URL` | No | PMDA 添付文書情報 XML の URL |
| `MHLW_YAKKA_URL` | No | 厚労省薬価基準データの URL |
| `VITE_API_BASE_URL` | No | フロントエンドの API ベース URL（デフォルト: `/api`） |

---

## 既知の制限事項

| 制限 | 詳細 |
|------|------|
| リアルタイム通信 | 現在はポーリング方式。WebSocket / SSE 未実装 |
| モバイルアプリ | Web のみ（PWA 対応は検討中） |
| 多言語対応 | 日本語 UI のみ（i18n 未実装） |
| ファイルサイズ | アップロードは 10MB まで |
| 同時接続 | Vercel Serverless のコールドスタートにより初回アクセス時に遅延あり |

---

## ライセンス

[MIT](LICENSE)
