import { useCallback, useMemo } from 'react';
import { Badge, ListGroup } from 'react-bootstrap';
import AppCard from '../ui/AppCard';
import InlineLoader from '../ui/InlineLoader';
import type { TimelineEvent } from '../../types/timeline';
import type { UploadStatus } from '../dashboard/types';

const MAX_DIGEST_ITEMS = 5;

interface DigestItem {
  id: string;
  title: string;
  description: string;
  badgeLabel: string;
  badgeVariant: 'danger' | 'warning' | 'primary' | 'success' | 'secondary';
  actionLabel: string;
  actionPath: string;
  event?: TimelineEvent;
}

interface SmartDigestProps {
  events: TimelineEvent[];
  status: UploadStatus | null;
  loading: boolean;
  onEventClick?: (event: TimelineEvent) => void;
  onActionPathClick?: (path: string) => void;
  className?: string;
}

function mapEventToDigestItem(event: TimelineEvent): DigestItem {
  if (event.priority === 'critical') {
    return {
      id: event.id,
      title: event.title,
      description: event.body,
      badgeLabel: '緊急',
      badgeVariant: 'danger',
      actionLabel: '今すぐ確認',
      actionPath: event.actionPath ?? '/',
      event,
    };
  }
  return {
    id: event.id,
    title: event.title,
    description: event.body,
    badgeLabel: '重要',
    badgeVariant: 'warning',
    actionLabel: '確認する',
    actionPath: event.actionPath ?? '/',
    event,
  };
}

function buildDigestItems(status: UploadStatus | null, events: TimelineEvent[]): DigestItem[] {
  const items: DigestItem[] = [];

  if (!status?.deadStockUploaded) {
    items.push({
      id: 'digest-upload-dead-stock',
      title: 'デッドストックリストをアップロード',
      description: '交換候補の母集団を作るため、先にデッドストックデータを登録してください。',
      badgeLabel: '必須',
      badgeVariant: 'warning',
      actionLabel: 'アップロードへ進む',
      actionPath: '/upload',
    });
  } else if (!status.usedMedicationUploaded) {
    items.push({
      id: 'digest-upload-used-medication',
      title: '医薬品使用量リストをアップロード',
      description: '当月データを登録すると、交換候補の精度が上がりマッチングが実行できます。',
      badgeLabel: '必須',
      badgeVariant: 'warning',
      actionLabel: 'アップロードへ進む',
      actionPath: '/upload',
    });
  }

  for (const event of events) {
    items.push(mapEventToDigestItem(event));
  }

  if (items.length === 0) {
    items.push({
      id: 'digest-run-matching',
      title: 'マッチングを実行',
      description: '最新データで交換候補を確認し、仮マッチング提案を開始してください。',
      badgeLabel: '推奨',
      badgeVariant: 'success',
      actionLabel: 'マッチングへ進む',
      actionPath: '/matching',
    });
  }

  return items.slice(0, MAX_DIGEST_ITEMS);
}

export default function SmartDigest({
  events,
  status,
  loading,
  onEventClick,
  onActionPathClick,
  className,
}: SmartDigestProps) {
  const digestItems = useMemo(() => buildDigestItems(status, events), [events, status]);
  const handleItemClick = useCallback((item: DigestItem) => {
    if (item.event) {
      onEventClick?.(item.event);
      return;
    }
    onActionPathClick?.(item.actionPath);
  }, [onActionPathClick, onEventClick]);

  return (
    <AppCard className={className ?? 'mb-3'}>
      <AppCard.Header className="d-flex align-items-center justify-content-between py-2 px-3">
        <span className="fw-semibold small">今日のアクション</span>
        {!loading && (
          <Badge bg="secondary" pill>
            {digestItems.length}
          </Badge>
        )}
      </AppCard.Header>

      <AppCard.Body className="p-0">
        {loading ? (
          <div className="px-3 py-2">
            <InlineLoader text="読み込み中..." />
          </div>
        ) : (
          <ListGroup variant="flush">
            {digestItems.map((item) => (
              <ListGroup.Item key={item.id} className="px-3 py-2">
                <div className="d-flex align-items-center justify-content-between gap-2">
                  <div className="d-flex align-items-center gap-2 min-w-0 flex-grow-1">
                    <Badge bg={item.badgeVariant} text={item.badgeVariant === 'warning' ? 'dark' : undefined}>
                      {item.badgeLabel}
                    </Badge>
                    <div className="d-flex flex-column min-w-0">
                      <span className="small text-truncate" style={{ maxWidth: '100%' }}>
                        {item.title}
                      </span>
                      <span className="small text-muted text-truncate" style={{ maxWidth: '100%' }}>
                        {item.description}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-link btn-sm p-0 text-nowrap small"
                    onClick={() => handleItemClick(item)}
                  >
                    {item.actionLabel} →
                  </button>
                </div>
              </ListGroup.Item>
            ))}
          </ListGroup>
        )}
      </AppCard.Body>
    </AppCard>
  );
}
