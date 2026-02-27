# Refactoring Issues

## [2026-02-27] Known Issues

### 初期調査の過大報告
- 探索エージェントがファイルサイズを10-35倍に過大報告した
- Metisの検証でwc -lで実測値を確認し、スコープを修正
