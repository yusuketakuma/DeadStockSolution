import { Suspense, lazy } from 'react';
import AppAlert from '../components/ui/AppAlert';
import { Form, ProgressBar } from 'react-bootstrap';
import AppSelect from '../components/ui/AppSelect';
import LoadingButton from '../components/ui/LoadingButton';
import AppControl from '../components/ui/AppControl';
import AppCard from '../components/ui/AppCard';
import AppButton from '../components/ui/AppButton';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import { resolveUploadTypeLabel } from './upload/upload-job-utils';
import { useUploadExcelFlow } from '../hooks/useUploadExcelFlow';

const CameraDeadStockRegisterPanel = lazy(() => import('./upload/CameraDeadStockRegisterPanel'));

const pageTitle = 'デッドストック取込（Excel / カメラ）';

function scrollToFlow(id: 'upload-excel-flow' | 'upload-camera-flow') {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function UploadPage() {
  const flow = useUploadExcelFlow();

  return (
    <PageShell>
      <h4 className="page-title mb-3">{pageTitle}</h4>
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
      {flow.error && <AppAlert variant="danger">{flow.error}</AppAlert>}
      {flow.message && <AppAlert variant="success">{flow.message}</AppAlert>}
      {flow.showMatchingHint && (
        <AppAlert variant="info">
          交換候補をすぐ確認する場合は「マッチング」ページで再実行してください。
        </AppAlert>
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
            列の対応付けは自動で行われるため、手動での設定は不要です。
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
            {!flow.hasPreviewRows && (
              <AppAlert variant="warning" className="small">
                プレビューに取込対象の行が見つかりません。ファイル内容を確認してください。
              </AppAlert>
            )}
            {!flow.hasResolvableMapping && (
              <AppAlert variant="warning" className="small">
                選択した取込種別で必要な列を自動判定できませんでした。ファイル見出しを確認してください。
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
