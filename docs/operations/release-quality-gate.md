# Release Quality Gate

## 目的

`preview` での継続検証と、製品として出荷してよいかの判定を分離しつつ、同じ用語とコマンドで運用できるようにする。

## 品質ゲートの階層

### 1. Preview Full Gate

`preview` ブランチに push するたびに必ず通す基準。

```bash
npm run verify:preview
```

含まれる項目:

1. `lint`
2. `typecheck`
3. `test:server`
4. `test:client`
5. `test:integration:server`
6. `test:perf:server`
7. `openapi:check`
8. `test:openapi-contract --workspace=server`
9. `audit:prod`
10. `build:server`
11. `build:client`

Deployment smoke を追加したい場合:

```bash
SMOKE_BASE_URL=https://<preview-deployment>.vercel.app npm run smoke:preview
```

Vercel protection が有効な preview では、必要に応じて以下も渡す。

```bash
SMOKE_PROTECTION_BYPASS=<vercel_automation_bypass_secret>
```

Vercel Git 連携が有効で `VERCEL_TOKEN` を使える場合、`smoke-check` は `GITHUB_SHA` / `GITHUB_REF_NAME` から最新 preview deployment を自動解決できる。CI ではこちらを優先する。

share URL を `SMOKE_BASE_URL` / `RELEASE_SMOKE_BASE_URL` にそのまま渡す運用も可能。`smoke-check` は query parameter 付き URL を保持したまま各 API に展開する。

GitHub Actions の `Preview Smoke` workflow で token 自動解決を使わない場合は、repository variable `PREVIEW_BRANCH_SMOKE_BASE_URL` に Vercel の branch-specific URL を設定する。

### 2. Release Gate

リリース候補を「製品として出せる状態」と判定する基準。

```bash
npm run verify:release
```

含まれる項目:

1. `verify:preview`
2. release candidate deployment に対する smoke

基本形:

```bash
RELEASE_SMOKE_BASE_URL=https://<release-candidate>.vercel.app \
RELEASE_PROTECTION_BYPASS=<vercel_automation_bypass_secret> \
npm run verify:release
```

`verify:release` は既定で deployment smoke まで必須です。手元で静的検証だけ見たい場合は `npm run verify:preview` を使う。

## 各ゲートの使い分け

- `preview` 開発中の必須確認: `npm run verify:preview`
- リリース候補の最終確認: `npm run verify:release`
- deployment の疎通だけ見たい: `npm run smoke:preview`
- 自動修正を含む定期スキャン: `npm run quality:gate`

## これを release 判定に含めないもの

以下は有用だが、release 可否の blocking 条件にはしない。

1. `test:coverage`
2. 手元だけの exploratory なブラウザ操作
3. docs 生成物の差分確認のみ

理由:

- coverage は品質シグナルではあるが、現時点では実態と閾値がずれており release 可否の判断を歪める
- release 判定は「動く」「壊れていない」「契約が保たれている」「本番依存が安全」の順に置く

## CI の意味づけ

- `.github/workflows/preview-smoke.yml`
  - `preview` ブランチ専用の release-equivalent gate
  - `verify:release` を使い、static checks と deployment smoke を両方通す
- `.github/workflows/ci.yml`
  - `main` / `dev` / `pull_request` 向けの継続検証
  - full suite / integration / build / contract を分担して実行

## 運用ルール

1. `preview` に載せる前に `npm run verify:preview` をローカルで通す
2. `preview` branch の required check では `npm run verify:release` を実行し、最新 preview deployment まで確認する
3. リリース候補を作ったら deployment URL を指定して `npm run verify:release` を通す
4. Vercel preview が保護されている場合、smoke には bypass secret を使う
5. full suite が不安定なら coverage や軽量テストに逃がさず、順序依存や環境依存を先に潰す
6. workflow / job 名を変更した場合は GitHub branch protection の required checks も同時に更新する
