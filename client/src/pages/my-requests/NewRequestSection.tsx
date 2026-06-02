import type { ChangeEvent } from 'react';
import { Badge, Form } from 'react-bootstrap';
import AppCard from '../../components/ui/AppCard';
import AppControl from '../../components/ui/AppControl';
import AppDropdownMenu from '../../components/ui/AppDropdownMenu';
import LoadingButton from '../../components/ui/LoadingButton';
import { categoryLabel, priorityLabel } from './helpers';
import { REQUEST_TEMPLATES, type DuplicateRequestSuggestion } from './types';

interface NewRequestSectionProps {
  showCreateForm: boolean;
  newRequestText: string;
  newCategory: string;
  newPriority: string;
  newFiles: File[];
  duplicateSuggestions: DuplicateRequestSuggestion[];
  creating: boolean;
  onOpenCreateForm: () => void;
  onCancel: () => void;
  onRequestTextChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onPriorityChange: (value: string) => void;
  onNewFilesChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
  onSelectSuggestion: (requestId: number) => void;
}

export function NewRequestSection({
  showCreateForm,
  newRequestText,
  newCategory,
  newPriority,
  newFiles,
  duplicateSuggestions,
  creating,
  onOpenCreateForm,
  onCancel,
  onRequestTextChange,
  onCategoryChange,
  onPriorityChange,
  onNewFilesChange,
  onSubmit,
  onSelectSuggestion,
}: NewRequestSectionProps) {
  return (
    <AppCard className="mb-3">
      <AppCard.Header>新しい要望</AppCard.Header>
      <AppCard.Body>
        {!showCreateForm ? (
          <div className="d-flex flex-column gap-2 gap-md-0 flex-md-row justify-content-between align-items-md-center">
            <div className="text-muted small">不具合修正や改善依頼を新しく登録できます。</div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onOpenCreateForm}
            >
              新しい要望を入力
            </button>
          </div>
        ) : (
          <div className="d-flex flex-column gap-3">
            <div className="dl-action-row mobile-stack">
              <AppDropdownMenu
                label="定型文を挿入"
                variant="outline-secondary"
                align="start"
                items={REQUEST_TEMPLATES.map((template, index) => ({
                  key: `new-request-template-${index}`,
                  label: template,
                  onClick: () => onRequestTextChange(template),
                }))}
              />
            </div>

            <div className="row g-2">
              <div className="col-12 col-md-4">
                <Form.Label htmlFor="new-request-category" className="small mb-1">要望カテゴリ</Form.Label>
                <Form.Select
                  id="new-request-category"
                  aria-label="要望カテゴリ"
                  value={newCategory}
                  onChange={(event) => onCategoryChange(event.target.value)}
                >
                  <option value="improvement">改善要望</option>
                  <option value="bug_report">不具合</option>
                  <option value="question">質問</option>
                  <option value="master_update">マスター更新</option>
                  <option value="integration_issue">連携不具合</option>
                </Form.Select>
              </div>
              <div className="col-12 col-md-4">
                <Form.Label htmlFor="new-request-priority" className="small mb-1">優先度</Form.Label>
                <Form.Select
                  id="new-request-priority"
                  aria-label="優先度"
                  value={newPriority}
                  onChange={(event) => onPriorityChange(event.target.value)}
                >
                  <option value="urgent">緊急</option>
                  <option value="normal">通常</option>
                  <option value="low">低</option>
                </Form.Select>
              </div>
              <div className="col-12 col-md-4">
                <Form.Label htmlFor="new-request-files" className="small mb-1">添付ファイル</Form.Label>
                <Form.Control
                  id="new-request-files"
                  aria-label="添付ファイル"
                  type="file"
                  multiple
                  onChange={onNewFilesChange}
                />
              </div>
            </div>

            <AppControl
              as="textarea"
              rows={4}
              value={newRequestText}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onRequestTextChange(event.target.value)}
              placeholder="依頼したい内容や困っていることを入力してください"
            />

            {newFiles.length > 0 && (
              <div className="small text-muted">{newFiles.map((file) => file.name).join(', ')}</div>
            )}

            {duplicateSuggestions.length > 0 && (
              <div className="border rounded p-3 bg-light">
                <div className="fw-semibold small mb-2">似た要望が見つかりました</div>
                <div className="d-flex flex-column gap-2">
                  {duplicateSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      className="btn btn-outline-secondary text-start"
                      onClick={() => onSelectSuggestion(suggestion.id)}
                    >
                      <div className="d-flex flex-wrap gap-1 mb-1">
                        <Badge bg="secondary">#{suggestion.id}</Badge>
                        <Badge bg="light" text="dark">{categoryLabel(suggestion.category)}</Badge>
                        <Badge bg="light" text="dark">{priorityLabel(suggestion.priority)}</Badge>
                      </div>
                      <div className="small">{suggestion.requestText}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="d-flex justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={onCancel}
                disabled={creating}
              >
                キャンセル
              </button>
              <LoadingButton
                variant="primary"
                onClick={onSubmit}
                loading={creating}
                loadingLabel="送信中..."
              >
                要望を送信
              </LoadingButton>
            </div>
          </div>
        )}
      </AppCard.Body>
    </AppCard>
  );
}
