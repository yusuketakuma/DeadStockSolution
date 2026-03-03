# Codex セットアップ（リポジトリ運用）

このリポジトリは `.codex/` をコミットし、共通設定を共有します。
ただし **信頼設定（trusted/untrusted）や notice はユーザー毎**です。

## 1. リポジトリ側（既に用意済み）
- `.codex/config.toml`
- `.codex/agents/*.toml`
- `AGENTS.md`

## 2. ユーザー側（各自が作る）
`~/.codex/config.toml` を作り、少なくとも以下を入れます：
- このリポジトリの trust 設定（trusted）
- （任意）notice の抑制
- （任意）ChatGPTログイン強制、資格情報ストアなど

例は `docs/local-user-config.example.toml` を参照。

## 3. trust が重要な理由
Codex はフォルダが未信頼だと read-only になったり、オンボーディングで許可が必要になります。 :contentReference[oaicite:2]{index=2}  
まず `/permissions` または `~/.codex/config.toml` の `[projects]` で trusted にしてください。

## 4. デフォルトが危険設定であること
このリポジトリ設定は `danger-full-access` + `approval_policy=never` です。
ネットワークやAppsを含めて制限が弱く、事故る設定です。 :contentReference[oaicite:3]{index=3}  
チーム導入時は profile を用意して段階運用するのが安全です。

## 5. macOS で `.codex` が見えない件
Finder はドットフォルダを隠します。
- Finder: `Cmd + Shift + .` で表示/非表示の切替
- Terminal: `ls -a` で確認
