---
_harness_template: "memory/decisions.md.template"
_harness_version: "2.23.6"
---

# Decisions (SSOT)

このファイルは「重要な意思決定」の単一の正（Single Source of Truth; SSOT）です。
議論ログは残しすぎず、**結論と理由、トレードオフ**を短く確実に残します。

## Index

- 2026-02-24: 技術スタック選定 React+Express+Drizzle+Vercel #stack #infra

---

## 2026-02-24: 技術スタック選定 #stack #infra

### 結論

- フロントエンド: React 18 + Vite + React Bootstrap
- バックエンド: Express 5 + Drizzle ORM + Vercel Postgres
- デプロイ: Vercel (serverless)

### 背景

- 薬局向けデッドストック管理システムとして、シンプルかつ高速な開発が必要

### 採用理由

- Vercel + Neon Postgres でサーバーレスデプロイが容易
- Drizzle ORM で型安全なDB操作
- React Bootstrap で迅速なUI構築

### 影響 / トレードオフ

- Vercel serverless の制約（実行時間、コールドスタート）
- Express 5 はまだ比較的新しい

### 見直し条件

- ユーザー数増加時にサーバーレスの制約が問題になる場合
