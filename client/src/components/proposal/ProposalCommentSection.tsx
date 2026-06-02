import { memo, useCallback } from 'react';
import AppButton from '../ui/AppButton';
import AppDataPanel from '../ui/AppDataPanel';
import AppDropdownMenu from '../ui/AppDropdownMenu';
import AppField from '../ui/AppField';
import LoadingButton from '../ui/LoadingButton';
import { formatDateTimeJa } from '../../utils/formatters';

const commentTemplates = [
  '内容確認しました。問題なければこのまま進めます。',
  '数量・期限を再確認したいので、対象明細の最新情報共有をお願いします。',
  'FAX送信済みです。到着確認をお願いします。',
];

export interface ProposalComment {
  id: number;
  authorPharmacyId: number;
  authorName: string;
  body: string;
  isDeleted: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

interface CommentListProps {
  comments: ProposalComment[];
  commentsLoading: boolean;
  currentUserId: number | undefined;
  isAdmin: boolean;
  editingCommentId: number | null;
  editingCommentBody: string;
  commentUpdatingId: number | null;
  commentDeletingId: number | null;
  onStartEdit: (comment: ProposalComment) => void;
  onCancelEdit: () => void;
  onUpdateComment: (commentId: number) => void;
  onDeleteComment: (commentId: number) => void;
  onEditingCommentBodyChange: (value: string) => void;
}

const CommentList = memo(function CommentList({
  comments,
  commentsLoading,
  currentUserId,
  isAdmin,
  editingCommentId,
  editingCommentBody,
  commentUpdatingId,
  commentDeletingId,
  onStartEdit,
  onCancelEdit,
  onUpdateComment,
  onDeleteComment,
  onEditingCommentBodyChange,
}: CommentListProps) {
  if (commentsLoading) {
    return <div className="small text-muted">コメントを読み込み中...</div>;
  }

  if (comments.length === 0) {
    return <div className="small text-muted">コメントはまだありません。</div>;
  }

  return (
    <div className="d-flex flex-column gap-2 mb-3">
      {comments.map((comment) => (
        <div key={comment.id} className="border rounded p-2">
          <div className="small text-muted">
            {comment.authorName} / {formatDateTimeJa(comment.createdAt)}
          </div>
          {editingCommentId === comment.id ? (
            <div className="mt-2 d-flex flex-column gap-2">
              <AppField
                controlId={`proposal-comment-edit-${comment.id}`}
                label="コメント編集"
                as="textarea"
                rows={3}
                maxLength={1000}
                value={editingCommentBody}
                onChange={onEditingCommentBodyChange}
              />
              <div className="d-flex gap-2">
                <LoadingButton
                  variant="primary"
                  onClick={() => onUpdateComment(comment.id)}
                  loading={commentUpdatingId === comment.id}
                  loadingLabel="更新中..."
                  disabled={!editingCommentBody.trim()}
                >
                  保存
                </LoadingButton>
                <AppButton
                  variant="outline-secondary"
                  onClick={onCancelEdit}
                  disabled={commentUpdatingId === comment.id}
                >
                  キャンセル
                </AppButton>
              </div>
            </div>
          ) : (
            <div>
              <div>{comment.body}</div>
              {comment.updatedAt && comment.createdAt && comment.updatedAt !== comment.createdAt && (
                <div className="small text-muted">編集済み</div>
              )}
            </div>
          )}
          {!isAdmin && comment.authorPharmacyId === currentUserId && !comment.isDeleted && editingCommentId !== comment.id && (
            <div className="d-flex gap-2 mt-2">
              <AppButton
                size="sm"
                variant="outline-primary"
                onClick={() => onStartEdit(comment)}
                disabled={commentDeletingId === comment.id}
              >
                編集
              </AppButton>
              <AppDropdownMenu
                label="コメント操作"
                variant="outline-secondary"
                items={[
                  {
                    key: `delete-comment-${comment.id}`,
                    label: commentDeletingId === comment.id ? '削除中...' : '削除',
                    onClick: () => onDeleteComment(comment.id),
                    disabled: commentDeletingId === comment.id,
                    danger: true,
                  },
                ]}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
});

interface CommentComposerProps {
  isAdmin: boolean;
  commentBody: string;
  commentSubmitting: boolean;
  sticky?: boolean;
  hasStickyActions: boolean;
  onCommentBodyChange: (value: string) => void;
  onSubmit: () => void;
  onApplyTemplate: (template: string) => void;
}

const CommentComposer = memo(function CommentComposer({
  isAdmin,
  commentBody,
  commentSubmitting,
  sticky,
  hasStickyActions,
  onCommentBodyChange,
  onSubmit,
  onApplyTemplate,
}: CommentComposerProps) {
  if (isAdmin) return null;

  return (
    <div
      data-testid={sticky ? 'proposal-mobile-comment-composer' : undefined}
      className={sticky ? 'position-sticky bottom-0 bg-body border-top p-2 safe-area-bottom' : 'd-flex flex-column gap-2'}
      style={sticky
        ? {
            zIndex: 999,
            bottom: hasStickyActions ? 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' : '0px',
          }
        : undefined}
    >
      <div className="dl-action-row mobile-stack">
        <AppDropdownMenu
          label="定型文を挿入"
          variant="outline-secondary"
          align="start"
          items={commentTemplates.map((template, index) => ({
            key: template,
            label: `定型文${index + 1}`,
            onClick: () => onApplyTemplate(template),
          }))}
        />
      </div>
      <AppField
        controlId="proposal-comment-body"
        label="新規コメント"
        as="textarea"
        rows={3}
        maxLength={1000}
        value={commentBody}
        onChange={onCommentBodyChange}
      />
      <LoadingButton
        variant="outline-primary"
        onClick={onSubmit}
        loading={commentSubmitting}
        loadingLabel="投稿中..."
        disabled={!commentBody.trim()}
      >
        コメントを投稿
      </LoadingButton>
    </div>
  );
});

interface ProposalCommentSectionProps {
  comments: ProposalComment[];
  commentsLoading: boolean;
  currentUserId: number | undefined;
  isAdmin: boolean;
  commentBody: string;
  commentSubmitting: boolean;
  editingCommentId: number | null;
  editingCommentBody: string;
  commentUpdatingId: number | null;
  commentDeletingId: number | null;
  includeComposer?: boolean;
  sticky?: boolean;
  hasStickyActions: boolean;
  onStartEdit: (comment: ProposalComment) => void;
  onCancelEdit: () => void;
  onUpdateComment: (commentId: number) => void;
  onDeleteComment: (commentId: number) => void;
  onEditingCommentBodyChange: (value: string) => void;
  onCommentBodyChange: (value: string) => void;
  onSubmit: () => void;
  onApplyTemplate: (template: string) => void;
}

export const ProposalCommentSection = memo(function ProposalCommentSection({
  comments,
  commentsLoading,
  currentUserId,
  isAdmin,
  commentBody,
  commentSubmitting,
  editingCommentId,
  editingCommentBody,
  commentUpdatingId,
  commentDeletingId,
  includeComposer = true,
  sticky,
  hasStickyActions,
  onStartEdit,
  onCancelEdit,
  onUpdateComment,
  onDeleteComment,
  onEditingCommentBodyChange,
  onCommentBodyChange,
  onSubmit,
  onApplyTemplate,
}: ProposalCommentSectionProps) {
  const handleApplyTemplate = useCallback((template: string) => {
    onApplyTemplate(template);
  }, [onApplyTemplate]);

  if (sticky) {
    return (
      <CommentComposer
        isAdmin={isAdmin}
        commentBody={commentBody}
        commentSubmitting={commentSubmitting}
        sticky={sticky}
        hasStickyActions={hasStickyActions}
        onCommentBodyChange={onCommentBodyChange}
        onSubmit={onSubmit}
        onApplyTemplate={handleApplyTemplate}
      />
    );
  }

  return (
    <AppDataPanel title="交渉メモ / コメント" className="mt-3">
      <CommentList
        comments={comments}
        commentsLoading={commentsLoading}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        editingCommentId={editingCommentId}
        editingCommentBody={editingCommentBody}
        commentUpdatingId={commentUpdatingId}
        commentDeletingId={commentDeletingId}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onUpdateComment={onUpdateComment}
        onDeleteComment={onDeleteComment}
        onEditingCommentBodyChange={onEditingCommentBodyChange}
      />
      {includeComposer ? (
        <CommentComposer
          isAdmin={isAdmin}
          commentBody={commentBody}
          commentSubmitting={commentSubmitting}
          hasStickyActions={hasStickyActions}
          onCommentBodyChange={onCommentBodyChange}
          onSubmit={onSubmit}
          onApplyTemplate={handleApplyTemplate}
        />
      ) : null}
    </AppDataPanel>
  );
});
