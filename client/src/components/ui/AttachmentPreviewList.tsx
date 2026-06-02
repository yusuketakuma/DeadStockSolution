import { useEffect, useMemo, useState } from 'react';
import { Spinner } from 'react-bootstrap';
import AppAlert from './AppAlert';
import AppButton from './AppButton';
import AppDropdownMenu from './AppDropdownMenu';
import AppModalShell from './AppModalShell';

export interface PreviewAttachment {
  id: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

type PreviewKind = 'image' | 'pdf' | 'text' | 'unsupported';

function formatFileSize(fileSize: number): string {
  if (fileSize >= 1024 * 1024) {
    return `${(fileSize / (1024 * 1024)).toFixed(1)}MB`;
  }
  return `${Math.max(1, Math.round(fileSize / 1024))}KB`;
}

function resolvePreviewKind(mimeType: string): PreviewKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('text/') || mimeType === 'application/json') return 'text';
  return 'unsupported';
}

interface AttachmentPreviewListProps {
  attachments: PreviewAttachment[];
  getDownloadUrl: (attachmentId: number) => string;
}

export default function AttachmentPreviewList({
  attachments,
  getDownloadUrl,
}: AttachmentPreviewListProps) {
  const [activeAttachment, setActiveAttachment] = useState<PreviewAttachment | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const previewKind = useMemo(
    () => resolvePreviewKind(activeAttachment?.mimeType ?? ''),
    [activeAttachment?.mimeType],
  );

  useEffect(() => () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  }, [previewUrl]);

  const resetPreviewState = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl('');
    setPreviewText('');
    setError('');
    setLoading(false);
  };

  const handleClose = () => {
    resetPreviewState();
    setActiveAttachment(null);
  };

  const handleOpenPreview = async (attachment: PreviewAttachment) => {
    const nextPreviewKind = resolvePreviewKind(attachment.mimeType);
    setActiveAttachment(attachment);
    resetPreviewState();

    if (nextPreviewKind === 'unsupported') {
      setError('このファイル形式はプレビュー対象外です。ダウンロードして確認してください。');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(getDownloadUrl(attachment.id), {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('添付ファイルの取得に失敗しました');
      }
      const blob = await response.blob();
      if (nextPreviewKind === 'text') {
        setPreviewText(await blob.text());
      } else {
        setPreviewUrl(URL.createObjectURL(blob));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '添付ファイルの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  if (attachments.length === 0) {
    return null;
  }

  return (
    <>
      <div className="d-flex flex-column gap-2 mt-2">
        {attachments.map((attachment) => {
          const itemPreviewKind = resolvePreviewKind(attachment.mimeType);
          return (
            <div
              key={attachment.id}
              className="d-flex flex-column flex-md-row gap-2 align-items-md-center justify-content-between border rounded p-2 bg-light-subtle"
            >
              <div className="small">
                <div className="fw-semibold">{attachment.fileName}</div>
                <div className="text-muted">{attachment.mimeType} / {formatFileSize(attachment.fileSize)}</div>
              </div>
              <div className="dl-action-row mobile-stack">
                <a
                  href={getDownloadUrl(attachment.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-sm btn-outline-primary"
                >
                  ダウンロード
                </a>
                {itemPreviewKind !== 'unsupported' && (
                  <AppDropdownMenu
                    label="その他"
                    size="sm"
                    variant="outline-secondary"
                    items={[
                      {
                        key: 'preview',
                        label: 'プレビュー',
                        onClick: () => { void handleOpenPreview(attachment); },
                      },
                    ]}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <AppModalShell
        show={activeAttachment !== null}
        onHide={handleClose}
        size="xl"
        title={activeAttachment?.fileName ?? '添付プレビュー'}
        footer={(
          <>
            {activeAttachment && (
              <a
                href={getDownloadUrl(activeAttachment.id)}
                target="_blank"
                rel="noreferrer"
                className="btn btn-outline-primary"
              >
                ダウンロード
              </a>
            )}
            <AppButton variant="secondary" onClick={handleClose}>
              閉じる
            </AppButton>
          </>
        )}
      >
        {loading ? (
          <div className="d-flex justify-content-center align-items-center py-5">
            <Spinner animation="border" size="sm" />
          </div>
        ) : error ? (
          <AppAlert variant="warning" className="mb-0">{error}</AppAlert>
        ) : previewKind === 'image' && previewUrl ? (
          <img src={previewUrl} alt={activeAttachment?.fileName ?? '添付プレビュー'} className="img-fluid rounded" />
        ) : previewKind === 'pdf' && previewUrl ? (
          <iframe
            src={previewUrl}
            title={activeAttachment?.fileName ?? '添付PDFプレビュー'}
            style={{ width: '100%', minHeight: '70vh', border: 0 }}
          />
        ) : previewKind === 'text' ? (
          <pre
            className="bg-light rounded p-3 small mb-0"
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '70vh', overflow: 'auto' }}
          >
            {previewText}
          </pre>
        ) : (
          <div className="text-muted small">プレビューできる内容がありません。</div>
        )}
      </AppModalShell>
    </>
  );
}
