import type { SavedView } from '../../utils/saved-views';
import AppDropdownMenu from './AppDropdownMenu';

interface SavedViewPreset<T> {
  key: string;
  name: string;
  description?: string;
  filters: T;
}

interface SavedViewsPanelProps<T> {
  title?: string;
  description: string;
  buttonLabel?: string;
  shareUrl?: string | null;
  savedViews: Array<SavedView<T>>;
  presets?: Array<SavedViewPreset<T>>;
  onSave: () => void;
  onApply: (filters: T) => void;
  onDelete: (id: string) => void;
}

export default function SavedViewsPanel<T>({
  title = '保存ビュー',
  description,
  buttonLabel = '現在のビューを保存',
  shareUrl,
  savedViews,
  presets = [],
  onSave,
  onApply,
  onDelete,
}: SavedViewsPanelProps<T>) {
  return (
    <div className="card mb-3">
      <div className="card-body">
        <div className="dl-action-row mobile-stack justify-content-between align-items-start">
          <div>
            <strong>{title}</strong>
            <div className="small text-muted">{description}</div>
          </div>
          <div className="dl-action-row mobile-stack">
            <button type="button" className="btn btn-outline-primary btn-sm" onClick={onSave}>
              {buttonLabel}
            </button>
            {shareUrl ? (
              <AppDropdownMenu
                label="共有"
                size="sm"
                variant="outline-secondary"
                items={[
                  {
                    label: 'URLをコピー',
                    onClick: () => {
                      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(shareUrl);
                      }
                    },
                  },
                ]}
              />
            ) : null}
          </div>
        </div>
        {presets.length > 0 && (
          <div className="mt-3">
            <div className="small text-muted mb-2">作業モード</div>
            <div className="dl-action-row mobile-stack">
              {presets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className="btn btn-outline-primary btn-sm"
                  onClick={() => onApply(preset.filters)}
                  title={preset.description}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {savedViews.length > 0 && (
          <div className="dl-action-row mobile-stack mt-2">
            {savedViews.map((view) => (
              <div key={view.id} className="d-flex align-items-center gap-1">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => onApply(view.filters)}
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 text-danger text-decoration-none"
                  onClick={() => onDelete(view.id)}
                  aria-label={`${view.name} を削除`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
