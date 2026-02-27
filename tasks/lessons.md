# tasks/lessons.md

## Repeated mistakes & counter-rules
- Pattern:
  - What happened:
  - Root cause:
  - New rule to prevent it:
- Pattern: レビュー指摘をそのまま適用しそうになり、ユーザーの明示意図（デモ資格情報は露出許容）との優先順位がぶれる
  - What happened: デモ資格情報露出に対するセキュリティ指摘を受け、非表示化前提で修正方針を取りかけた
  - Root cause: 一般的なセキュリティベストプラクティスを優先し、今回の要件意図を再確認する前に方針を進めた
  - New rule to prevent it: レビュー指摘がユーザー要件と衝突した場合、まず要件優先で可否を確定し、許容されたリスクは記録したうえで別の実害リスクのみ修正する
- Pattern: 画面実装時に「固定デモ値」を先に置き、実DB由来の要件（テスト薬局2件表示）を後追いで差し替えた
  - What happened: ログイン画面に固定デモ資格情報ボタンを先に追加した後、ユーザー指定でDB登録済みテスト薬局表示へ再実装になった
  - Root cause: データソース要件（固定値かDB参照か）を初手で明示確認せず、実装を先行した
  - New rule to prevent it: 認証/アカウント表示系UIは最初に「データの真実源（DB/API/env固定値）」を確定し、未確定なら表示UIと取得APIを分離して差し替えコストを最小化する

## Project-specific gotchas
- Item:
  - Why it matters:
  - How to detect:
  - How to fix:
