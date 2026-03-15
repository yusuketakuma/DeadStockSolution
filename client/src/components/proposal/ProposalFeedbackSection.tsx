import { memo } from 'react';
import AppDataPanel from '../ui/AppDataPanel';
import AppSelect from '../ui/AppSelect';
import AppField from '../ui/AppField';
import LoadingButton from '../ui/LoadingButton';

interface ProposalFeedbackSectionProps {
  isCompletedPhase: boolean;
  isAdmin: boolean;
  feedbackRating: string;
  feedbackComment: string;
  feedbackSubmitting: boolean;
  onRatingChange: (value: string) => void;
  onCommentChange: (value: string) => void;
  onSubmit: () => void;
}

export const ProposalFeedbackSection = memo(function ProposalFeedbackSection({
  isCompletedPhase,
  isAdmin,
  feedbackRating,
  feedbackComment,
  feedbackSubmitting,
  onRatingChange,
  onCommentChange,
  onSubmit,
}: ProposalFeedbackSectionProps) {
  if (!isCompletedPhase || isAdmin) return null;

  return (
    <AppDataPanel title="取引評価" className="mt-3">
      <div className="row g-2 align-items-end">
        <div className="col-md-2">
          <AppSelect
            controlId="proposal-feedback-rating"
            value={feedbackRating}
            ariaLabel="評価"
            onChange={onRatingChange}
            options={[
              { value: '5', label: '5' },
              { value: '4', label: '4' },
              { value: '3', label: '3' },
              { value: '2', label: '2' },
              { value: '1', label: '1' },
            ]}
          />
        </div>
        <div className="col-md-7">
          <AppField
            controlId="proposal-feedback-comment"
            label="コメント（任意）"
            as="textarea"
            rows={2}
            maxLength={300}
            value={feedbackComment}
            onChange={onCommentChange}
          />
        </div>
        <div className="col-md-3">
          <LoadingButton
            onClick={onSubmit}
            loading={feedbackSubmitting}
            loadingLabel="登録中..."
            className="w-100"
          >
            評価を登録
          </LoadingButton>
        </div>
      </div>
    </AppDataPanel>
  );
});
