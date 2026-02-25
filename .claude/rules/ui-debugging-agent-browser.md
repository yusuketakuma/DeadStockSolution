---
description: UIデバッグ/検証は agent-browser（インストール済みの場合）を優先する
alwaysApply: true
_harness_template: "rules/ui-debugging-agent-browser.md.template"
_harness_version: "2.25.0"
---

# UI Debugging Rule (Prefer Agent Browser)

## 基本方針

- UI/UXの不具合・画面上の再現が必要な調査は、**agent-browser を最優先で使う**
- 他のブラウザ系ツール（MCP の chrome-devtools、playwright）より先に agent-browser を試す
- 画面とソースコードを往復しながら、**再現 → 原因推定 → 修正 → 再検証** を短いサイクルで回す

## 進め方（推奨）

### 1. 再現条件を固める
- 対象URL、ユーザー状態（ログイン/権限/データ）、期待値/実際の挙動を明文化

### 2. agent-browser で再現

```bash
agent-browser open https://example.com/target-page
agent-browser snapshot -i -c
agent-browser click @e1
agent-browser fill @e2 "text"
```

### 3. 観測→仮説→コード確認
- スナップショット/スクリーンショット/コンソールログの情報を根拠に、原因候補を絞る

### 4. 最小修正で直す
- 変更範囲を抑え、意図と副作用を説明できる修正にする

### 5. agent-browser で再検証
- 同じ手順で再現しないことを確認

## よく使うコマンド

```bash
agent-browser open <url>          # ページを開く
agent-browser snapshot -i -c      # スナップショット（AI向け）
agent-browser click @e1           # クリック
agent-browser fill @e2 "text"     # 入力
agent-browser screenshot out.png  # スクリーンショット
agent-browser --headed open <url> # ブラウザを表示
agent-browser console             # コンソールログ表示
```

## フォールバック

agent-browser が使えない場合:
1. MCP ブラウザツール（chrome-devtools, playwright）
2. 手動再現（再現手順・スクショ・コンソールログ）
3. 自動E2E（Playwright/Cypress テスト追加）
