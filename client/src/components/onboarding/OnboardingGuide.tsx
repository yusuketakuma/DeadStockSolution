import { Modal, ProgressBar, ListGroup } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import AppButton from '../ui/AppButton';
import { ONBOARDING_STEPS } from './onboardingSteps';
import type { UploadStatus } from '../dashboard/types';
import { useAuth } from '../../contexts/AuthContext';

interface Props {
  status: UploadStatus | null;
  onDismiss: () => void;
}

export default function OnboardingGuide({ status, onDismiss }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const completedCount = ONBOARDING_STEPS.filter((s) => s.isComplete(status, user?.id)).length;
  const progress = Math.round((completedCount / ONBOARDING_STEPS.length) * 100);

  const handleAction = (path: string) => {
    onDismiss();
    navigate(path);
  };

  return (
    <Modal show centered size="lg" onHide={onDismiss}>
      <Modal.Header closeButton>
        <Modal.Title>はじめてのセットアップガイド</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <ProgressBar now={progress} label={`${completedCount}/${ONBOARDING_STEPS.length}`} className="mb-3" />
        <ListGroup variant="flush">
          {ONBOARDING_STEPS.map((step) => {
            const done = step.isComplete(status, user?.id);
            return (
              <ListGroup.Item
                key={step.id}
                className={`d-flex justify-content-between align-items-start ${done ? 'text-muted' : ''}`}
              >
                <div>
                  <div className="fw-semibold">
                    {done ? '\u2713 ' : ''}{step.title}
                  </div>
                  <div className="small">{step.description}</div>
                </div>
                {!done && (
                  <AppButton
                    size="sm"
                    variant="primary"
                    onClick={() => handleAction(step.actionPath)}
                  >
                    {step.actionLabel}
                  </AppButton>
                )}
              </ListGroup.Item>
            );
          })}
        </ListGroup>
      </Modal.Body>
      <Modal.Footer>
        <AppButton variant="link" onClick={onDismiss}>後で表示する</AppButton>
      </Modal.Footer>
    </Modal>
  );
}
