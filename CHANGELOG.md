# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.0.1]: https://github.com/yusuketakuma/DeadStockSolution/commits/v0.0.1
