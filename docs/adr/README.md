# Architecture Decision Records (ADR)

このディレクトリはプロジェクトの重要な設計・アーキテクチャ上の決定を記録します。

## ADR とは

ADR（Architecture Decision Record）は、「なぜその設計にしたか」を後から追えるようにするための文書です。
コードだけでは伝わらない判断の背景・トレードオフを残し、将来の変更判断に活かします。

## ファイル命名規則

```
NNN-short-title.md
```

- `NNN`: 3桁の連番（例: `001`, `012`）
- `short-title`: ハイフン区切りの短い説明（例: `use-jwt-for-auth`）

## ステータス

| ステータス | 意味 |
|-----------|------|
| `proposed` | 提案中・議論中 |
| `accepted` | 採用済み |
| `deprecated` | 廃止（理由を記載） |
| `superseded by NNN` | 別の ADR に置き換えられた |

## 新しい ADR の作成手順

1. `000-template.md` をコピーして連番ファイルを作成
2. Status を `proposed` にして PR を作成
3. レビュー後に `accepted` に変更してマージ
4. このREADMEのインデックスに追記

## インデックス

| No. | タイトル | Status | Date |
|-----|---------|--------|------|
| 000 | [テンプレート](000-template.md) | — | — |
