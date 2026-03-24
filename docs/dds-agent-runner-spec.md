# DDS agent runner spec

## Goal

DeadStockSolution の `managed_remote_agent` 連携を実際に動かすため、OpenClaw 側に **`dds-agent-runner`** という別ランナーを置く。

役割を分離する。

- **DDS-agents**: 実務担当。work item の解釈、実装、調査、PR、質問生成を行う。
- **dds-agent-runner**: 接続担当。`register -> jobs/claim -> heartbeat -> question/pr callback` を回す。

この分離により、接続維持ロジックと実務ロジックを混ぜず、障害切り分け・再試行・将来拡張を容易にする。

---

## Current assessment

### Already implemented on server side

DeadStockSolution 側には以下がある。

- `POST /api/openclaw/connect/register`
- `POST /api/openclaw/connect/jobs/claim`
- `POST /api/openclaw/connect/heartbeat`
- `POST /api/openclaw/connect/work-items/:id/question`
- `POST /api/openclaw/connect/work-items/:id/pr`

また、DB スキーマとして以下がある。

- `dds_bootstrap_tokens`
- `dds_agent_connections`
- `dds_agent_jobs`
- `dds_work_items`

### Missing / unconfirmed on OpenClaw side

現時点で未確認または不足の可能性が高いもの。

- bootstrap token を使って `register` する実行主体
- control token を保持する永続化
- `jobs/claim` をポーリングする loop
- `heartbeat` を定期送信する loop
- `question` / `pr` callback を返す bridge
- claim した work item を DDS-agents に渡す executor

---

## Naming policy

### User-facing name
- `DDS-agents`

### Internal names
- OpenClaw 実務 agent id: `dss-manager`（当面維持）
- 新規 runner id / directory: `dds-agent-runner`

### Reason

内部 id を一気に rename すると、既存 config / agentDir / runtime の参照切れリスクが高い。
そのため、まずは表示名だけ `DDS-agents` に統一し、runner は別名で新設する。

---

## Responsibilities

## 1. DDS-agents

### Responsibility
- claim 済み work item を処理する
- 必要に応じて質問を返す
- 実装・調査・レビュー・PR 作成を行う
- 進捗や結果を構造化して返す

### Non-responsibility
- register
- claim polling
- lease/heartbeat 維持
- token 永続化
- callback の HTTP 送信制御

---

## 2. dds-agent-runner

### Responsibility
- bootstrap token で register
- control token / connection 情報の保存
- `jobs/claim` の polling
- `heartbeat` の定期送信
- claim 済み job の dispatcher
- DDS-agents 実行結果を `question` / `pr` に返す
- retry / backoff / lease 管理
- 実行メトリクスとログ出力

### Non-responsibility
- ビジネス判断
- work item の深い解釈
- 実装修正そのもの

---

## System design

```text
DeadStockSolution server
  ├─ register
  ├─ jobs/claim
  ├─ heartbeat
  ├─ question callback
  └─ pr callback
        ↑
        │ HTTPS + control token
        ↓
OpenClaw: dds-agent-runner
  ├─ register loop (initial)
  ├─ claim loop
  ├─ heartbeat loop
  ├─ job state store
  └─ DDS-agents bridge
        ↓
OpenClaw: DDS-agents (dss-manager)
  ├─ understand work item
  ├─ ask question if blocked
  ├─ implement / research / review
  └─ return result / PR metadata
```

---

## Runtime state

`dds-agent-runner` は最低限次をローカル保持する。

### Local state file
候補:
- `~/.openclaw/agents/dds-agent-runner/runtime/state.json`

### Stored fields
- `connectionId`
- `controlToken`
- `agentLabel`
- `registeredAt`
- `lastHeartbeatAt`
- `leaseExpiresAt`
- `lastClaimAt`
- `activeJobId`
- `pollIntervalSeconds`
- `serverBaseUrl`
- `runnerVersion`

### Notes
- control token はログに出さない
- 可能なら権限を 600 に制限する
- state 破損時は再 register 可能な設計にする

---

## Required environment variables

## Server-side prerequisites
- `OPENCLAW_CONNECTOR_MODE=managed_remote_agent`
- `OPENCLAW_PUBLIC_BASE_URL` または正しい `VERCEL_URL`
- DDS 関連 migration 適用済み

## Runner-side variables

最低限候補:
- `DDS_AGENT_SERVER_BASE_URL`
- `DDS_AGENT_BOOTSTRAP_TOKEN`
- `DDS_AGENT_LABEL` 例: `DDS-agents`
- `DDS_AGENT_POLL_INTERVAL_SECONDS`（default 15〜30）
- `DDS_AGENT_HEARTBEAT_INTERVAL_SECONDS`（default lease の 1/3〜1/2）
- `DDS_AGENT_STATE_PATH`
- `DDS_AGENT_OPENCLAW_AGENT_ID`（default `dss-manager`）

追加候補:
- `DDS_AGENT_MAX_CONCURRENT_JOBS`（初期は 1 推奨）
- `DDS_AGENT_LOG_LEVEL`
- `DDS_AGENT_REQUEST_TIMEOUT_MS`

---

## API flow

## Phase 1: register

### Input
- bootstrap token
- agent label
- capabilities / version / callback support 情報

### Output
- `connectionId`
- `controlToken`
- lease 情報
- poll 推奨秒数

### Failure handling
- bootstrap token invalid → fatal
- temporary 5xx/network → exponential backoff で再試行

---

## Phase 2: claim loop

### Behavior
- 一定間隔で `jobs/claim`
- active job 実行中は並列 1 を基本
- job なしの場合は idle のまま heartbeat 維持

### Claim result patterns
- `no_job`
- `claimed(job)`
- `connection_invalid`
- `lease_expired`
- `retry_later`

### Failure handling
- `connection_invalid` / `lease_expired` → register からやり直す
- network failure → backoff

---

## Phase 3: heartbeat loop

### Behavior
- active / idle どちらでも送る
- active 時は `activeJobId` を含める
- 死活監視と lease 延長を兼ねる

### Data
- connection id
- control token
- current status (`idle` / `busy` / `blocked` / `error`)
- active job ids
- current version
- lightweight metrics

---

## Phase 4: execute claimed job

### Dispatcher steps
1. claim 結果を local state に反映
2. work item payload を整形
3. DDS-agents に実行依頼
4. 実行中の進捗を local state に反映
5. ブロック時は `question` callback
6. 完了時は `pr` callback または completion payload
7. state を idle に戻す

---

## DDS-agents bridge contract

## Input to DDS-agents
runner は DDS-agents に少なくとも以下を渡す。

- `workItemId`
- `jobId`
- `requestSummary`
- `fullInstructions`
- `repoContext`
- `reportUrl` / callback endpoint info
- `questionRules`
- `completionRules`
- `deadline` / priority

## Output from DDS-agents
少なくとも以下を返せる必要がある。

- `status`: `completed` | `blocked` | `failed`
- `summary`
- `question`（必要時）
- `pr` metadata（PR URL / title / summary / branch など）
- `artifacts`
- `riskNotes`
- `nextAction`

### Transport options
推奨順:
1. OpenClaw session / agent invocation API
2. `openclaw agent --agent dss-manager --message ...` CLI bridge
3. 中間 JSON ファイル経由

初期実装では **CLI bridge** が一番現実的。

---

## Callback policy

## question callback
送る条件:
- 実行継続に必要な情報不足
- 人判断が必須
- 仕様衝突

送る内容:
- concise question
- blocking reason
- known options
- recommended option

## pr callback
送る条件:
- 実装完了
- PR 作成済みまたは PR 相当の成果物作成済み

送る内容:
- PR URL
- title
- summary
- changed files summary
- verification summary
- remaining risks

---

## Retry / backoff policy

### Register
- 5s → 15s → 30s → 60s
- invalid bootstrap token は即停止

### Claim
- no job: poll interval に戻る
- transient error: +jitter backoff
- repeated auth failure: state clear → re-register

### Callback
- idempotency key を付けられるなら付与
- 同じ question / pr を多重送信しない

---

## Observability

最低限残すログ:
- register success/failure
- claim success/empty/failure
- heartbeat success/failure
- active job start/finish/fail
- callback success/failure
- re-register events

成果物:
- `runtime/runner.log`
- `runtime/state.json`
- `runtime/job-history.jsonl`

重要:
- token や secret は絶対にマスク

---

## Initial implementation scope (v1)

### In scope
- single worker
- single active job
- local state persistence
- register / claim / heartbeat
- DDS-agents CLI bridge
- question / pr callback
- retry / backoff

### Out of scope
- multi-job parallelism
- distributed lock
- advanced dashboard
- dynamic auto-scaling
- multiple target repos in one worker

---

## Directory proposal

```text
~/.openclaw/agents/dds-agent-runner/
  agent/
    RUNNER.md
    config.json
  runtime/
    state.json
    runner.log
    job-history.jsonl
  scripts/
    run-dds-agent-runner.mjs
    register.mjs
    heartbeat.mjs
    claim-and-dispatch.mjs
```

---

## Operational decision

### Recommended
- `DDS-agents` は高推論のまま維持
- `dds-agent-runner` は薄く小さく保つ
- worker 側で business logic を増やさない

### Why
runner を賢くしすぎると、再び責務が混ざるため。

---

## Implementation roadmap

### Step 1
- runner spec を確定
- env naming を確定
- state file schema を確定

### Step 2
- register / heartbeat / claim の最小 CLI 実装
- local state persistence 実装

### Step 3
- `dss-manager` bridge 実装
- question / pr callback 実装

### Step 4
- preview 環境で接続テスト
- lease 切れ / network error / callback retry を確認

### Step 5
- production rollout

---

## Acceptance criteria

以下を満たしたら v1 完了。

- bootstrap token で register できる
- control token を保持できる
- job を claim できる
- heartbeat で lease 維持できる
- claimed job を DDS-agents に渡せる
- blocked 時に question callback できる
- 完了時に pr callback できる
- 再起動後に state を復元できる
- token がログに漏れない

---

## Recommendation

**別 runner 方式を正式採用する。**

- UI/表示名は `DDS-agents`
- OpenClaw 実務 agent は `dss-manager`
- 接続維持専用に `dds-agent-runner` を追加

この構成が、今の DeadStockSolution 実装と最も自然に接続でき、保守もしやすい。
