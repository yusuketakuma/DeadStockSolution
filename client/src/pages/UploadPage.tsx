import { Suspense, lazy, useMemo, type ReactNode } from 'react';
import AppAlert from '../components/ui/AppAlert';
import { Form, ProgressBar } from 'react-bootstrap';
import { Link, useSearchParams } from 'react-router-dom';
import AppSelect from '../components/ui/AppSelect';
import LoadingButton from '../components/ui/LoadingButton';
import AppControl from '../components/ui/AppControl';
import AppCard from '../components/ui/AppCard';
import AppButton from '../components/ui/AppButton';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import EnrichmentPreview from '../components/upload/EnrichmentPreview';
import ColumnMappingForm from '../components/upload/ColumnMappingForm';
import { resolveUploadTypeLabel } from './upload/upload-job-utils';
import { useUploadExcelFlow } from '../hooks/useUploadExcelFlow';
import { useRecentWorkList } from '../hooks/useRecentWork';
import AppDropdownMenu from '../components/ui/AppDropdownMenu';

const CameraDeadStockRegisterPanel = lazy(() => import('./upload/CameraDeadStockRegisterPanel'));

const pageTitle = 'デッドストック取込（Excel / カメラ）';

interface StructuredError {
  cause: string;
  solution: string;
}

const ERROR_PATTERNS: Array<{ match: (msg: string) => boolean; structured: StructuredError }> = [
  {
    match: (msg) => msg.includes('先にプレビューを実行してください'),
    structured: {
      cause: 'ファイルが選択されていないか、プレビューが実行されていません。',
      solution: 'Excelファイルを選択し、「プレビュー」ボタンを押してから登録してください。',
    },
  },
  {
    match: (msg) => msg.includes('自動判定に必要な列が不足'),
    structured: {
      cause: '選択した取込種別に必要な列名がファイル内に見つかりませんでした。',
      solution: '「薬品名」「薬品コード」「数量」「薬価」などの必須列が含まれているか、ページ内の「Excel 必須項目ガイド」を確認してください。',
    },
  },
  {
    match: (msg) => msg.includes('アップロード処理の受付に失敗') || msg.includes('UPLOAD_CONFIRM_QUEUE_LIMIT'),
    structured: {
      cause: 'サーバーのアップロード処理キューが上限に達しています。',
      solution: 'しばらく時間をおいてから再度お試しください。問題が続く場合は管理者にお問い合わせください。',
    },
  },
  {
    match: (msg) => msg.includes('待機時間が上限を超えました') || msg.includes('待機時間が長くなっています'),
    structured: {
      cause: 'アップロード処理の待機時間が長くなっています。サーバーが混雑している可能性があります。',
      solution: 'ジョブは継続中の可能性があります。時間をおいてから在庫一覧ページで取込結果を確認してください。',
    },
  },
  {
    match: (msg) => msg.includes('プレビューに失敗') || msg.includes('Excel解析'),
    structured: {
      cause: 'Excelファイルの解析に失敗しました。ファイル形式が正しくないか、破損している可能性があります。',
      solution: '.xlsx 形式のファイルを使用しているか確認し、別のExcelファイルで再度お試しください。',
    },
  },
];

function resolveStructuredError(errorMessage: string): StructuredError | null {
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.match(errorMessage)) {
      return pattern.structured;
    }
  }
  return null;
}

function StructuredErrorAlert({ errorMessage }: { errorMessage: string }): ReactNode {
  const structured = resolveStructuredError(errorMessage);
  if (!structured) {
    return <AppAlert variant="danger">{errorMessage}</AppAlert>;
  }
  return (
    <AppAlert variant="danger">
      <div><strong>原因:</strong> {structured.cause}</div>
      <div className="mt-1"><strong>解決策:</strong> {structured.solution}</div>
    </AppAlert>
  );
}

function scrollToFlow(id: 'upload-excel-flow' | 'upload-camera-flow') {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function UploadPage() {
  const [searchParams] = useSearchParams();
  const flow = useUploadExcelFlow();
  const recentWork = useRecentWorkList(4);
  const inventoryDestination = flow.uploadType === 'dead_stock' ? '/inventory/dead-stock' : '/inventory/used-medication';
  const failedCount = flow.uploadJob.partialSummary?.rejectedRows ?? flow.uploadJob.partialSummary?.failed ?? 0;
  const reuseSavedMapping = searchParams.get('reuseSavedMapping') === '1';
  const issueCodeHint = (searchParams.get('issueCode') ?? '').trim();

  const enrichmentMapping = useMemo(() => {
    if (!flow.preview) return null;
    const typeMapping = flow.preview.suggestedMappingByType?.[flow.uploadType] ?? flow.preview.suggestedMapping ?? {};
    const numericMapping: Record<string, number | null> = {};
    for (const [key, val] of Object.entries(typeMapping)) {
      numericMapping[key] = val !== null && val !== undefined ? Number(val) : null;
    }
    return numericMapping;
  }, [flow.preview, flow.uploadType]);

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">{pageTitle}</h4>
        </div>
        <div className="dl-page-header-actions mobile-stack">
          <AppDropdownMenu
            label="関連画面"
            variant="outline-secondary"
            items={[
              { key: 'quality', to: '/upload-quality', label: '品質を確認' },
              { key: 'dead-stock', to: '/inventory/dead-stock', label: 'デッドストックを確認' },
              { key: 'used-medication', to: '/inventory/used-medication', label: '使用量リストを確認' },
              { key: 'matching', to: '/matching', label: '候補を探す' },
              { key: 'statistics', to: '/statistics', label: '統計を確認' },
            ]}
          />
        </div>
      </div>
      <AppCard className="mb-3 upload-entry-card-shell">
        <AppCard.Body className="upload-entry-grid">
          <section className="upload-entry-card-item" aria-labelledby="upload-entry-excel">
            <h5 id="upload-entry-excel" className="h6 mb-2">Excelアップロード</h5>
            <div className="small text-muted mb-3">
              一括で在庫データを登録する場合は、Excelファイルから取込みます。
            </div>
            <AppButton variant="outline-primary" onClick={() => scrollToFlow('upload-excel-flow')}>
              Excel取込へ移動
            </AppButton>
          </section>
          <section className="upload-entry-card-item" aria-labelledby="upload-entry-camera">
            <h5 id="upload-entry-camera" className="h6 mb-2">カメラ取込み</h5>
            <div className="small text-muted mb-3">
              カメラ画像のコードから候補医薬品を自動提示し、手動確定で登録します。
            </div>
            <AppButton variant="outline-primary" onClick={() => scrollToFlow('upload-camera-flow')}>
              カメラ取込へ移動
            </AppButton>
          </section>
        </AppCard.Body>
      </AppCard>
      {recentWork.length > 0 && (
        <AppCard className="mb-3">
          <AppCard.Header>最近触った案件</AppCard.Header>
          <AppCard.Body className="dl-action-row mobile-stack align-items-center">
            <Link to={recentWork[0].to} className="btn btn-sm btn-outline-primary">
              {recentWork[0].label}
            </Link>
            {recentWork.length > 1 ? (
              <AppDropdownMenu
                label="ほかの作業"
                size="sm"
                variant="outline-secondary"
                items={recentWork.slice(1).map((item) => ({
                  key: item.id,
                  to: item.to,
                  label: item.label,
                }))}
              />
            ) : null}
            <span className="small text-muted">アップロード後に戻ることが多い案件や画面へすぐ再開できます。</span>
          </AppCard.Body>
        </AppCard>
      )}
      {flow.error && <StructuredErrorAlert errorMessage={flow.error} />}
      {reuseSavedMapping && (
        <AppAlert variant="info">
          保存済みの列マッピングを再利用する前提で再アップロードを進めます。
          {issueCodeHint && <> 確認対象: <strong>{issueCodeHint}</strong></>}
          {' '}ファイルを選択してプレビューすると、前回設定があれば自動で反映されます。
        </AppAlert>
      )}
      {flow.message && <AppAlert variant="success">{flow.message}</AppAlert>}
      {flow.showMatchingHint && (
        <AppAlert variant="info">
          交換候補をすぐ確認する場合は「マッチング」ページで再実行してください。
        </AppAlert>
      )}
      {flow.showMatchingHint && (
        <AppCard className="mb-3">
          <AppCard.Header>取込後の次アクション</AppCard.Header>
          <AppCard.Body className="d-flex flex-column gap-3">
            <div className="small text-muted">
              取込結果の確認、問題行の確認、候補再計算の確認をこの流れで進められます。
            </div>
            <div className="dl-action-row mobile-stack">
              <Link
                to="/upload-quality"
                className={`btn btn-sm ${failedCount > 0 || flow.canDownloadErrorReport ? 'btn-danger' : 'btn-outline-danger'}`}
              >
                {failedCount > 0 || flow.canDownloadErrorReport ? '問題行を確認' : '品質を確認'}
              </Link>
              <AppDropdownMenu
                label="その他"
                variant="outline-secondary"
                items={[
                  { key: 'inventory', to: inventoryDestination, label: '反映済み在庫を確認' },
                  { key: 'matching', to: '/matching', label: '候補を再計算' },
                  {
                    key: 'error-report',
                    label: 'エラーレポート',
                    onClick: flow.triggerErrorReportDownload,
                    disabled: !flow.canDownloadErrorReport,
                  },
                ]}
              />
            </div>
            <div className="small text-muted">
              {failedCount > 0
                ? `今回の取込では ${failedCount} 件の要確認データがあります。先に品質画面を開くことを推奨します。`
                : '品質画面で問題がなければ、そのまま在庫反映とマッチング候補確認へ進めます。'}
            </div>
          </AppCard.Body>
        </AppCard>
      )}

      <ScrollArea>
      <div className="upload-dual-flow-grid">
      <section id="upload-excel-flow" className="upload-dual-flow-section">
      {flow.uploadProgress.phase !== 'idle' && (
        <AppCard className="mb-3">
          <AppCard.Body>
            <div className="small mb-2">{flow.uploadProgress.label}</div>
            <ProgressBar
              animated={flow.uploadProgressAnimated}
              now={flow.uploadProgress.percent}
              variant={flow.uploadProgressVariant}
            />
            {flow.uploadJob.jobId !== null && (
              <div className="small text-muted mt-2">
                ジョブID: {flow.uploadJob.jobId}
                {flow.uploadJob.status && ` / 状態: ${flow.uploadJob.status === 'pending' ? '待機中' : '処理中'}`}
                {' '} / 試行回数: {flow.uploadJob.attempts}
              </div>
            )}
            {flow.uploadJob.deduplicated && (
              <div className="small text-info mt-2">
                同一内容の送信は重複ジョブとして集約されました。
              </div>
            )}
            {flow.partialSummaryEntries.length > 0 && (
              <div className="small mt-2">
                部分サマリー:
                {' '}
                {flow.partialSummaryEntries.map((entry) => `${entry.label} ${entry.value}件`).join(' / ')}
              </div>
            )}
            {(flow.uploadJob.cancelable || flow.uploadJob.errorReportAvailable) && (
              <div className="d-flex gap-2 mt-2">
                <AppButton
                  size="sm"
                  variant="outline-warning"
                  disabled={!flow.uploadJob.cancelable || flow.cancellingJob}
                  onClick={() => void flow.handleCancelJob()}
                >
                  {flow.cancellingJob ? 'キャンセル中...' : 'このジョブをキャンセル'}
                </AppButton>
                <AppButton
                  size="sm"
                  variant="outline-secondary"
                  disabled={!flow.uploadJob.errorReportAvailable}
                  onClick={flow.triggerErrorReportDownload}
                >
                  エラーレポートをダウンロード
                </AppButton>
              </div>
            )}
          </AppCard.Body>
        </AppCard>
      )}

      <AppCard className="mb-3">
        <AppCard.Header>アップロード手順</AppCard.Header>
        <AppCard.Body>
          <ol className="mb-2 upload-step-list">
            <li>Excelファイル（.xlsx・最大50MB）を選択します。</li>
            <li>「プレビュー」を押して、ファイルの内容を確認します。</li>
            <li>取込種別（デッドストック／使用量）が正しいことを確認します。</li>
            <li>「この設定でデータを登録」を押して反映します。</li>
          </ol>
          <div className="small text-muted mt-1">
            列の対応付けは自動で行われますが、必要に応じて手動で変更できます。
          </div>
        </AppCard.Body>
      </AppCard>

      <AppCard className="mb-3">
        <AppCard.Header>Excel 必須項目ガイド</AppCard.Header>
        <AppCard.Body>
          <div className="small">
            <h6 className="fw-bold mb-2">デッドストックリスト</h6>
            <div className="table-responsive">
            <table className="table table-sm table-bordered mb-3">
              <thead className="table-light">
                <tr>
                  <th>列名</th>
                  <th>必須</th>
                  <th>説明</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="fw-bold">薬品名</td>
                  <td><span className="badge bg-danger">必須</span></td>
                  <td>医薬品の名称。マッチングの基本キーです</td>
                </tr>
                <tr>
                  <td className="fw-bold">薬品コード</td>
                  <td><span className="badge bg-danger">必須</span></td>
                  <td>YJコード・JANコード・GS1コード・HOTコードのいずれか。医薬品マスターとの紐付けに使用し、薬価・単位・包装形態（PTP/バラ）を自動設定します</td>
                </tr>
                <tr>
                  <td className="fw-bold">数量</td>
                  <td><span className="badge bg-danger">必須</span></td>
                  <td>在庫数量（0より大きい数値）</td>
                </tr>
                <tr>
                  <td className="fw-bold">薬価単価</td>
                  <td><span className="badge bg-danger">必須</span></td>
                  <td>1単位あたりの薬価（円）。マッチングスコアの算出に使用します。薬品コードによるマスター紐付けで自動補完も可能です</td>
                </tr>
                <tr>
                  <td>単位</td>
                  <td><span className="badge bg-info text-dark">推奨</span></td>
                  <td>錠・PTP・バラ等。包装形態の区別に使用します</td>
                </tr>
                <tr>
                  <td>使用期限</td>
                  <td><span className="badge bg-info text-dark">推奨</span></td>
                  <td>期限切れ品の自動除外・期限間近品の優先マッチに使用</td>
                </tr>
                <tr>
                  <td>ロット番号</td>
                  <td><span className="badge bg-secondary">任意</span></td>
                  <td>交換成立後のトレーサビリティ（ロット回収対応等）に使用</td>
                </tr>
              </tbody>
            </table>
            </div>

            <h6 className="fw-bold mb-2">使用実績リスト</h6>
            <div className="table-responsive">
            <table className="table table-sm table-bordered mb-0">
              <thead className="table-light">
                <tr>
                  <th>列名</th>
                  <th>必須</th>
                  <th>説明</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="fw-bold">薬品名</td>
                  <td><span className="badge bg-danger">必須</span></td>
                  <td>マッチング相手側のキーとなる医薬品名</td>
                </tr>
                <tr>
                  <td className="fw-bold">薬品コード</td>
                  <td><span className="badge bg-danger">必須</span></td>
                  <td>YJコード・JANコード・GS1コード・HOTコードのいずれか。マスター紐付けと包装互換性チェックに必須です</td>
                </tr>
                <tr>
                  <td>月間使用量</td>
                  <td><span className="badge bg-info text-dark">推奨</span></td>
                  <td>需要予測・消費可能期間の推定に使用</td>
                </tr>
                <tr>
                  <td>単位</td>
                  <td><span className="badge bg-info text-dark">推奨</span></td>
                  <td>包装バリアント選定の精度向上に使用</td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
          <div className="small text-muted mt-2">
            薬品コードから医薬品マスターを参照し、薬価・単位・包装形態（PTP/バラ等）を自動設定します。
            PTP包装品とバラ品は区別してマッチングされるため、正確な薬品コードの入力が重要です。
          </div>
        </AppCard.Body>
      </AppCard>

      <AppCard className="mb-3">
        <AppCard.Body>
          <Form onSubmit={flow.handlePreview}>
            <Form.Group className="mb-3" controlId="upload-file">
              <Form.Label>Excelファイル (.xlsx)</Form.Label>
              <AppControl
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={flow.handleFileChange}
                ref={flow.fileRef}
              />
            </Form.Group>

            <LoadingButton type="submit" variant="primary" disabled={!flow.file} loading={flow.loading} loadingLabel="プレビュー中...">
              プレビュー
            </LoadingButton>
          </Form>
        </AppCard.Body>
      </AppCard>

      {flow.loading && flow.uploadProgress.phase === 'idle' && <ProgressBar animated now={100} className="mb-3" />}

      {flow.preview && (
        <AppCard className="mb-3">
          <AppCard.Header>取込内容の確認</AppCard.Header>
          <AppCard.Body>
            <Form.Group className="mb-3" controlId="upload-type">
              <Form.Label>取込種別（自動判定）</Form.Label>
              <AppSelect
                controlId="upload-type"
                value={flow.uploadType}
                ariaLabel="取込種別"
                disabled={flow.loading}
                onChange={(value) => flow.setUploadType(value as typeof flow.uploadType)}
                options={[
                  { value: 'dead_stock', label: 'デッドストックリスト' },
                  { value: 'used_medication', label: '医薬品使用量リスト' },
                ]}
              />
              <div className="small text-muted mt-1">
                自動判定: {resolveUploadTypeLabel(flow.preview.detectedUploadType)}（信頼度: {flow.resolveConfidenceLabel(flow.preview.uploadTypeConfidence)}）
                {' '} / スコア: 在庫 {flow.preview.uploadTypeScores.dead_stock}・使用量 {flow.preview.uploadTypeScores.used_medication}
                {flow.preview.rememberedUploadType && (
                  <>
                    {' '} / 前回記憶: {resolveUploadTypeLabel(flow.preview.rememberedUploadType)}
                  </>
                )}
              </div>
              {flow.preview.hasSavedMapping && (
                <div className="small text-muted mt-1">
                  同一ヘッダーの過去アップロード設定を参照しています。
                </div>
              )}
              {flow.hasManualTypeOverride && (
                <div className="small text-warning mt-1">
                  自動判定結果を手動修正しています。この種別で取り込みます。
                </div>
              )}
            </Form.Group>

            <div className="table-responsive mb-3">
              <table className="table table-sm table-bordered mobile-table">
                <thead>
                  <tr>
                    {flow.preview.headers.map((header, headerIdx) => (
                      <th key={headerIdx} className="small">{header || `列${headerIdx + 1}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {flow.preview.rows.slice(0, 3).map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      {row.map((cell, cellIdx) => (
                        <td key={cellIdx} className="small">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {flow.hasPreviewRows && flow.preview && enrichmentMapping && (
              <EnrichmentPreview
                previewRows={flow.preview.rows}
                mapping={enrichmentMapping}
              />
            )}

            {flow.preview && (
              <ColumnMappingForm
                headers={flow.preview.headers}
                mapping={flow.currentMapping}
                uploadType={flow.uploadType}
                missingRequiredFields={flow.missingRequiredFields}
                fieldHints={flow.fieldHints}
                mappingComplete={flow.mappingComplete}
                onChange={flow.handleMappingChange}
              />
            )}

            {!flow.hasPreviewRows && (
              <AppAlert variant="warning" className="small">
                <div><strong>原因:</strong> ヘッダー行の下にデータ行が見つかりませんでした。</div>
                <div className="mt-1"><strong>解決策:</strong> 「薬品名」「数量」列を含むデータ行がシートに存在するか確認してください。</div>
              </AppAlert>
            )}
            {!flow.hasResolvableMapping && (
              <AppAlert variant="warning" className="small">
                <div><strong>原因:</strong> 選択した取込種別に必要な列名がファイルのヘッダーから自動判定できませんでした。</div>
                <div className="mt-1"><strong>解決策:</strong> 取込種別を切り替えるか、ページ内の「Excel 必須項目ガイド」を参照して列名を修正してください。</div>
              </AppAlert>
            )}

            <hr />

            <Form.Group className="mb-2" controlId="upload-apply-mode">
              <Form.Label>反映方式</Form.Label>
              <AppSelect
                controlId="upload-apply-mode"
                value={flow.applyMode}
                ariaLabel="反映方式"
                disabled={flow.loading}
                onChange={(value) => flow.setApplyMode(value as 'replace' | 'diff')}
                options={[
                  { value: 'replace', label: '置換' },
                  { value: 'diff', label: '差分反映' },
                ]}
              />
              <div className="small text-muted mt-1">
                {flow.preview.hasSavedMapping
                  ? '同一ヘッダーの過去設定を検出しました。反映方式は必要に応じて選択してください。'
                  : '初回アップロードのため、反映方式を選択して登録してください。'}
              </div>
            </Form.Group>

            {flow.applyMode === 'diff' && (
              <Form.Group className="mb-2">
                <Form.Check
                  id="upload-delete-missing"
                  type="checkbox"
                  label="差分に存在しない既存データを無効化/削除する"
                  checked={flow.deleteMissing}
                  onChange={(e) => flow.setDeleteMissing(e.currentTarget.checked)}
                />
                <div className="mt-2">
                  <LoadingButton
                    variant="outline-secondary"
                    size="sm"
                    onClick={flow.handleDiffPreview}
                    loading={flow.loading}
                    loadingLabel="差分比較中..."
                  >
                    差分プレビューを更新
                  </LoadingButton>
                </div>
              </Form.Group>
            )}

            {flow.applyMode === 'diff' && flow.diffSummary && (
              <AppAlert variant="info" className="small">
                追加: {flow.diffSummary.inserted}件 / 更新: {flow.diffSummary.updated}件 / 無効化・削除: {flow.diffSummary.deactivated}件 / 変更なし: {flow.diffSummary.unchanged}件
                {' '}（取込総数: {flow.diffSummary.totalIncoming}件）
              </AppAlert>
            )}

            <div className="mt-3 mobile-stack">
              <LoadingButton
                variant="success"
                onClick={flow.handleConfirm}
                disabled={!flow.canSubmit}
                loading={flow.loading}
                loadingLabel="登録中..."
              >
                この設定でデータを登録
              </LoadingButton>
              {flow.requiresDeleteImpactAcknowledgement && (
                <div className="small text-warning mt-2">
                  <Form.Check
                    id="upload-delete-impact-ack"
                    type="checkbox"
                    label={`無効化・削除 ${flow.diffSummary?.deactivated ?? 0} 件の影響を確認しました`}
                    checked={flow.acknowledgeDeleteImpact}
                    onChange={(e) => flow.setAcknowledgeDeleteImpact(e.currentTarget.checked)}
                  />
                </div>
              )}
              {!flow.mappingComplete && (
                <div className="small text-warning mt-2">
                  必須フィールドのマッピングを設定してから登録してください。
                </div>
              )}
              {flow.requiresDiffPreviewRefresh && !flow.diffSummary && (
                <div className="small text-warning mt-2">
                  無効化・削除を有効にした場合は、送信前に「差分プレビューを更新」を実行してください。
                </div>
              )}
            </div>
          </AppCard.Body>
        </AppCard>
      )}
      </section>
      <section id="upload-camera-flow" className="upload-dual-flow-section">
        <Suspense fallback={(
          <AppCard className="mb-3">
            <AppCard.Body className="small text-muted">カメラ登録画面を読み込み中です...</AppCard.Body>
          </AppCard>
        )}
        >
          <CameraDeadStockRegisterPanel />
        </Suspense>
      </section>
      </div>
      </ScrollArea>
    </PageShell>
  );
}
