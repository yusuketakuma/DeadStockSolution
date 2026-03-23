# ADR-004: チャート実装方針

- **Date**: 2026-03-23
- **Status**: accepted

## Context（背景・課題）

DashboardPage (T951) と StatisticsPage (T952c) にチャートを追加する必要がある。

**表示要件:**

| タスク | チャート種類 | 用途 |
|--------|------------|------|
| T951 | compact bar/sparkline | KPI カード内の期限リスク分布（expired / within30 / within60 / within90 / over120 の件数比較） |
| T952c | 折れ線グラフ（3系列） | 月次推移（交換量・デッドストック推移・提案成約率） |

**制約:**

- client/node_modules は現在 23MB（軽量に維持したい）
- vite.config.ts で `chunkSizeWarningLimit: 500KB`、既存 vendor chunk 分割あり
- React 19 + Bootstrap 5 SPA（SSR なし）
- chart ライブラリは未導入（package.json に recharts/d3/Chart.js の記載なし）

## 検討した選択肢

### A: Chart.js + react-chartjs-2

- **Pro**: gzip 約 60KB と軽量、Canvas ベースで描画が速い、折れ線・棒グラフを標準サポート、APIが安定している
- **Pro**: react-chartjs-2 は Chart.js の薄いラッパーで React ライフサイクルと統合しやすい
- **Con**: Canvas ベースのため SVG と比べて CSS でのスタイル操作が限定的
- **Con**: SSR 非対応（本プロジェクトは SPA のため問題なし）
- **バンドル影響**: chart.js + react-chartjs-2 で約 60〜70KB gzip。`vendor-charts` chunk を追加して分離可能

### B: recharts

- **Pro**: React コンポーネントベース（SVG）、カスタマイズ性が高い
- **Con**: gzip 約 250KB。D3 を内包するため大きい
- **Con**: 本プロジェクトの要件（シンプルな棒・折れ線）に対してオーバースペック

### C: SVG/CSS 自作

- **Pro**: 依存ゼロ、完全制御、バンドル増加なし
- **Pro**: T951 の compact bar なら実装量は少ない
- **Con**: T952c の折れ線グラフ（軸スケール計算、ツールチップ、レスポンシブ）は自作コストが大きい
- **Con**: 将来チャート種類が増えるたびに再実装が必要

## Decision（決定内容）

**Chart.js + react-chartjs-2 を採用する（選択肢 A）。**

インストール:

```bash
npm install chart.js react-chartjs-2 -w client
```

vite.config.ts の `manualChunks` に以下を追加し、メインチャンクへの混入を防ぐ:

```ts
if (id.includes('chart.js') || id.includes('react-chartjs-2')) {
  return 'vendor-charts';
}
```

### 実装指針

**T951 (DashboardPage KPI compact bar)**

- `<Bar>` コンポーネントを使用
- 高さ 60〜80px の compact サイズ（`maintainAspectRatio: false`）
- 凡例・軸ラベルは非表示（KPI カード内のため）
- データ: `bucketCounts` の各バケット件数を棒グラフで可視化
- カラー: Bootstrap の danger/warning/success に合わせる（CSS 変数参照）

**T952c (StatisticsPage 月次トレンド折れ線)**

- `<Line>` コンポーネントを使用、3系列（交換量・デッドストック・成約率）
- X軸: 日付ラベル、Y軸: 2軸（件数と率を分離）
- レスポンシブ: `responsive: true`
- ツールチップ: デフォルト有効

### 実装時の共通パターン

```tsx
// 必要な Chart.js コンポーネントのみ登録（tree-shaking のため）
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, ... } from 'chart.js';
ChartJS.register(CategoryScale, LinearScale, BarElement, ...);
```

ChartJS.register は各コンポーネントファイルで行い、不要なモジュールを含めない。

## Consequences（結果・トレードオフ）

### 良い点

- 60〜70KB gzip の追加で T951・T952c 両要件を満たせる
- `vendor-charts` chunk 分割により初期ロードへの影響を最小化
- 将来チャート追加時（他ページへの展開）もライブラリを再利用可能
- Canvas ベースで多数データポイントでも描画が速い

### 悪い点・注意点

- Canvas は `window.devicePixelRatio` の考慮が必要（高解像度ディスプレイでぼやける場合あり。react-chartjs-2 が自動対応）
- テスト時は `canvas` を jsdom がサポートしないため `jest-canvas-mock` または `vi.mock('chart.js')` が必要
- 本 ADR 適用後、T951/T952c の実装者は `manualChunks` 追加を必ず実施すること

### bundle サイズ予算

| 追加内容 | 見込みサイズ (gzip) |
|---------|-------------------|
| chart.js | 約 55KB |
| react-chartjs-2 | 約 5KB |
| 合計 (vendor-charts chunk) | 約 60KB |

現状の `chunkSizeWarningLimit: 500KB` の範囲内に収まる。
