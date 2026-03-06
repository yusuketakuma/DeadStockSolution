# 薬局アカウント自動認証設計

> 作成日: 2026-03-01
> ステータス: 承認済み

## 概要

薬局アカウント開設時にOpenClawを介して厚生局の薬局機能情報提供制度APIを検索し、薬局名と開設許可番号の一致を確認したうえでアカウントを承認する事前審査制の仕組み。

## アプローチ

**案A: OpenClaw統合 + 非同期審査キュー** を採用。

OpenClawをサービス全体の保守管理エージェントとして位置づけ、その機能の1つとしてアカウント検証を実行する。既存の `user_requests` パイプラインを流用し、OpenClawが薬局機能情報提供制度APIを検索・照合する。

## 全体フロー

```
薬局ユーザーが登録フォーム送信
    ↓
① 基本バリデーション（メール重複、必須項目、パスワード強度）
    ↓
② pharmacies テーブルに仮レコード作成
   verificationStatus: 'pending_verification'
   isActive: false（ログイン不可）
    ↓
③ pharmacyRegistrationReviews にレコード作成（既存）
    ↓
④ user_requests に検証リクエスト自動投入
   requestType: 'pharmacy_verification'
   内容: 薬局名、住所、開設許可番号
    ↓
⑤ OpenClaw が受信・処理
   → 薬局機能情報提供制度APIで検索
   → 薬局名 + 許可番号の一致を確認
    ↓
⑥ OpenClaw がコールバックで結果を返す
    ↓
⑦ コールバック受信 → ステータス更新
   一致: verificationStatus → 'verified', isActive → true
   不一致: verificationStatus → 'rejected'
    ↓
⑧ メール通知（承認/却下）
```

## ステータス遷移

```
pending_verification → verified    (OpenClaw承認)
pending_verification → rejected    (OpenClaw却下)
rejected → pending_verification    (再申請時)
```

`isActive` は新規登録時は false。審査承認時に true へ遷移する。  
既存ユーザーのプロフィール更新による再審査では `isActive` は true のまま `pending_verification` へ遷移し、利用継続を許可する。

## DBスキーマ変更

### pharmacies テーブルへの追加カラム

| カラム | 型 | デフォルト | 説明 |
|--------|-----|-----------|------|
| verificationStatus | varchar | 'pending_verification' | 'pending_verification' / 'verified' / 'rejected'（legacy: 'unverified'） |
| verificationRequestId | integer | null | user_requests.id への参照 |
| verifiedAt | timestamp | null | 検証完了日時 |
| rejectionReason | text | null | 却下理由 |

既存アカウント（マイグレーション時）: `verificationStatus = 'verified'`

### user_requests テーブル

既存の `requestType` に `'pharmacy_verification'` と `'pharmacy_reverification'` を利用。構造変更なし。

## OpenClaw連携詳細

### 検証リクエスト投入フォーマット

```json
{
  "pharmacyId": 123,
  "requestType": "pharmacy_verification | pharmacy_reverification",
  "status": "pending_handoff",
  "content": {
    "pharmacyName": "○○薬局",
    "postalCode": "100-0001",
    "prefecture": "東京都",
    "address": "千代田区...",
    "licenseNumber": "A-12345",
    "instruction": "薬局機能情報提供制度APIで以下を検索し、薬局名と開設許可番号の一致を確認してください"
  }
}
```

### OpenClaw検証フロー

1. 住所（都道府県+市区町村）で薬局機能情報提供制度APIを検索
2. 開設許可番号で絞り込み
3. 薬局名の照合
4. 判定結果をコールバック（approved / rejected + 理由）

### コールバック処理

既存の `POST /api/openclaw/callback` を拡張。`requestType` が `pharmacy_verification` または `pharmacy_reverification` の場合:
- pharmacies.verificationStatus を更新
- isActive を更新
- pharmacyRegistrationReviews に結果を記録
- 通知メール送信

## APIエンドポイント

| エンドポイント | メソッド | 変更種別 | 説明 |
|---|---|---|---|
| `/api/auth/register` | POST | 変更 | 即時承認を廃止。仮アカウント作成 + OpenClawリクエスト投入 |
| `/api/openclaw/callback` | POST | 変更 | pharmacy_verification タイプの結果処理を追加 |
| `/api/auth/verification-status` | GET | 新規 | 審査中ユーザーがステータスを確認 |
| `/api/admin/pharmacies` | GET | 変更 | verificationStatus でフィルタ可能に |
| `/api/admin/pharmacies/:id/verify` | POST | 新規 | 管理者による手動承認（フォールバック） |

## フロントエンド変更

| ページ | 変更種別 | 説明 |
|---|---|---|
| RegisterPage.tsx | 変更 | 登録完了後「審査中」メッセージ画面へ遷移 |
| VerificationPendingPage.tsx | 新規 | 審査状況の表示（ポーリングで更新） |
| LoginPage.tsx | 変更 | 審査中アカウントでログイン時に審査状況画面へリダイレクト |
| 管理者画面 | 変更 | 薬局一覧に検証ステータス列追加、手動承認ボタン |

## エラーハンドリング

| シナリオ | 対応 |
|---|---|
| 薬局機能情報APIが応答しない | OpenClawがリトライ。3回失敗で管理者アラート |
| OpenClawが24時間以内に応答なし | 管理者にメール通知。手動承認 or 再リクエスト可能 |
| 許可番号が複数ヒット | OpenClawが住所も加味して最適候補を選定 |
| 登録メールが既に使用済み | 従来通り 409 エラー |
| 審査中に同一情報で再登録 | 既存の審査中レコードを返し重複防止 |

## セキュリティ

- OpenClawコールバックのHMAC-SHA256署名検証（既存の仕組みを流用）
- 審査中アカウントは isActive=false でAPI操作不可
- 手動承認は isAdmin=true のみ
- 登録情報はOpenClawにそのまま送信OK（開発者専用ツール）

## テスト計画

### サーバーサイド
- 登録API: 仮アカウント作成 + user_requests投入の統合テスト
- Webhookコールバック: 承認/却下それぞれのステータス遷移テスト
- 手動承認API: 管理者権限チェック + ステータス更新テスト
- 審査タイムアウト: 24時間経過後のアラートテスト

### フロントエンド
- 登録完了 → 審査中画面への遷移テスト
- 審査中アカウントでのログイン → リダイレクトテスト
- ステータスポーリングによるUI更新テスト
