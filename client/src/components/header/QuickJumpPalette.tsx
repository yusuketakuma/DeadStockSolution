import { useEffect, useMemo, useState } from 'react';
import { Form } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import AppButton from '../ui/AppButton';
import AppModalShell from '../ui/AppModalShell';
import type { RecentWorkItem } from '../../utils/recent-work';

export interface QuickJumpItem {
  id: string;
  label: string;
  to: string;
  section: string;
  subtitle?: string;
}

interface QuickJumpPaletteProps {
  show: boolean;
  onHide: () => void;
  routes: QuickJumpItem[];
  recentWork: RecentWorkItem[];
  cases?: QuickJumpItem[];
  loadingCases?: boolean;
}

function matchesQuery(item: QuickJumpItem, query: string): boolean {
  const haystack = `${item.label} ${item.section} ${item.subtitle ?? ''} ${item.to}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function renderJumpButton(
  item: QuickJumpItem,
  onSelect: (target: string) => void,
  variant = 'outline-secondary',
) {
  return (
    <button
      key={item.id}
      type="button"
      className={`btn btn-sm btn-${variant} text-start`}
      onClick={() => onSelect(item.to)}
    >
      <div className="fw-semibold">{item.label}</div>
      <div className="small text-muted">{item.section}{item.subtitle ? ` / ${item.subtitle}` : ''}</div>
    </button>
  );
}

export default function QuickJumpPalette({
  show,
  onHide,
  routes,
  recentWork,
  cases = [],
  loadingCases = false,
}: QuickJumpPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!show) {
      setQuery('');
    }
  }, [show]);

  const recentItems = useMemo(() => recentWork
    .map<QuickJumpItem>((item) => ({
      id: `recent-${item.id}`,
      label: item.label,
      to: item.to,
      section: item.section,
      subtitle: item.subtitle,
    }))
    .filter((item) => matchesQuery(item, query))
    .slice(0, 6), [query, recentWork]);

  const routeItems = useMemo(() => routes
    .filter((item) => matchesQuery(item, query))
    .slice(0, 10), [query, routes]);
  const caseItems = useMemo(() => cases
    .filter((item) => matchesQuery(item, query))
    .slice(0, 10), [cases, query]);

  const handleSelect = (target: string) => {
    navigate(target);
    onHide();
  };

  return (
    <AppModalShell
      show={show}
      onHide={onHide}
      title="クイックジャンプ"
      size="lg"
      footer={(
        <div className="w-100 d-flex justify-content-between align-items-center gap-2 flex-wrap">
          <span className="small text-muted">⌘/Ctrl + K でいつでも開けます。</span>
          <AppButton type="button" variant="outline-secondary" size="sm" onClick={onHide}>
            閉じる
          </AppButton>
        </div>
      )}
    >
      <div className="d-flex flex-column gap-3">
        <Form.Control
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="提案、要望、OpenClaw、通知などで検索"
          aria-label="クイックジャンプ検索"
        />

        {recentItems.length > 0 && (
          <div className="d-flex flex-column gap-2">
            <div className="fw-semibold">最近触った案件</div>
            <div className="d-flex flex-column gap-2">
              {recentItems.map((item) => renderJumpButton(item, handleSelect, 'outline-primary'))}
            </div>
          </div>
        )}

        <div className="d-flex flex-column gap-2">
          <div className="fw-semibold">案件ジャンプ</div>
          {loadingCases ? (
            <div className="small text-muted">案件候補を読み込み中...</div>
          ) : caseItems.length > 0 ? (
            <div className="d-flex flex-column gap-2">
              {caseItems.map((item) => renderJumpButton(item, handleSelect, 'outline-primary'))}
            </div>
          ) : (
            <div className="small text-muted">一致する案件がありません。</div>
          )}
        </div>

        <div className="d-flex flex-column gap-2">
          <div className="fw-semibold">主要画面</div>
          {routeItems.length > 0 ? (
            <div className="d-flex flex-column gap-2">
              {routeItems.map((item) => renderJumpButton(item, handleSelect))}
            </div>
          ) : (
            <div className="small text-muted">一致する画面がありません。</div>
          )}
        </div>
      </div>
    </AppModalShell>
  );
}
