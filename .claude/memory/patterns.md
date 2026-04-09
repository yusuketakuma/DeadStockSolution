---
_harness_template: "memory/patterns.md.template"
_harness_version: "2.23.6"
---

# Patterns (SSOT)

このファイルは「再利用できる解法（パターン）」の単一の正（SSOT）です。
**問題 → 解法 → 適用条件**まで残し、次回同じ判断を高速に再現できるようにします。

## Index

- Drizzle ORM スキーマ定義は server/src/db/schema.ts に集約 #db #drizzle
- API ルートは server/src/app.ts で一元登録 #api #routing

---
