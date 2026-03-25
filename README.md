# DeadStockSolution

[![CI](https://github.com/yusuketakuma/DeadStockSolution/actions/workflows/ci.yml/badge.svg)](https://github.com/yusuketakuma/DeadStockSolution/actions/workflows/ci.yml)
[![Lighthouse CI](https://github.com/yusuketakuma/DeadStockSolution/actions/workflows/lighthouse.yml/badge.svg)](https://github.com/yusuketakuma/DeadStockSolution/actions/workflows/lighthouse.yml)

**薬局間のデッドストック交換を自動化する業務システム**

在庫アップロード → AIマッチング → 提案・交渉 → 交換完了までをワンストップで管理。
滞留在庫の削減と廃棄損失の抑制を実現します。

🔗 **[dead-stock-solution.vercel.app](https://dead-stock-solution.vercel.app/)**

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

- **Excelアップロード** — 非同期ジョブ処理でデッドストック/使用量データを一括登録
- **差分反映** — replace / diff / partial 方式を選択可能、取り込み失敗行の確認にも対応
- **医薬品マスター連携** — 厚労省の薬価基準データ・PMDA包装単位データを自動取得

### マッチング・交換

- **AIマッチング** — 薬剤名類似度・期限・距離・相互不動在庫解消効果を加味して候補を優先度付け
- **交換ワークフロー** — 提案作成 → 承認/拒否 → 確定 → 交換完了を一貫管理
- **コメント・フィードバック** — 交換の追跡性を確保、信頼スコアの算出

### 通知・ダッシュボード

- **タイムライン** — 未読数、重要イベント、ダイジェストを集約
- **統計ダッシュボード** — アップロード状況、在庫リスク、提案/交換実績を可視化
- **リアルタイムバッジ** — サイドバーに未対応件数をリアルタイム表示

### 管理者パネル（13ページ）

- 薬局運用管理、グループ管理、アラート管理、監査ログ
- マッチング性能分析、アップロード品質分析
- ユーザーリクエスト管理、一括操作（CSV）
- OpenClaw外部連携管理

---

## デモ環境

🔗 **https://dead-stock-solution.vercel.app/**

### テストログイン

デモ環境では **テストログイン機能** が有効です。ログイン画面で「テストアカウントでログイン」を選択すると、5つのテスト薬局アカウントが表示されます。パスワード入力なしですぐに操作を試せます。

### できること

- テスト薬局としてログインし、在庫アップロード・マッチング候補の閲覧・交換提案の作成が可能
- 管理者アカウントでは管理者パネルの全機能にアクセス可能
- データは preview 環境のため、自由に操作いただけます

> **注意**: デモ環境のデータは定期的にリセットされる場合があります。

---

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| **フロントエンド** | React 18 + TypeScript + Vite + React Bootstrap |
| **バックエンド** | Express 5 + TypeScript + Drizzle ORM |
| **データベース** | PostgreSQL (Vercel Postgres / Neon) |
| **認証** | WorkOS AuthKit (OAuth 2.0) + JWT |
| **デプロイ** | Vercel (Serverless Functions) |
| **モノレポ** | npm workspaces (`client/` + `server/`) |
| **テスト** | Vitest + Supertest + PGlite統合テスト |
| **CI/CD** | GitHub Actions + Lighthouse CI |

---

## はじめかた

### 前提条件

- Node.js 20+
- npm 10+
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
├── vercel.json                # Vercel設定
└── package.json               # ルート (npm workspaces)
```

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

## ライセンス

[MIT](LICENSE)
