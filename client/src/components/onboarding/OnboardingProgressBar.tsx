interface OnboardingProgressBarProps {
  currentStep: number;
  totalSteps: number;
}

const STEP_LABELS = ['基本情報', '許可証情報', '確認'];

export default function OnboardingProgressBar({ currentStep, totalSteps }: OnboardingProgressBarProps) {
  const percent = Math.round((currentStep / totalSteps) * 100);

  return (
    <div className="mb-4">
      <div className="d-flex justify-content-between mb-1">
        {STEP_LABELS.slice(0, totalSteps).map((label, index) => {
          const stepNum = index + 1;
          const isCompleted = stepNum < currentStep;
          const isActive = stepNum === currentStep;
          return (
            <span
              key={label}
              className={`small fw-semibold ${isActive ? 'text-primary' : isCompleted ? 'text-success' : 'text-muted'}`}
              aria-current={isActive ? 'step' : undefined}
            >
              {stepNum}. {label}
            </span>
          );
        })}
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={currentStep}
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-label={`ステップ ${currentStep} / ${totalSteps}`}
        style={{ height: '6px' }}
      >
        <div
          className="progress-bar"
          style={{ width: `${percent}%`, transition: 'width 0.3s ease' }}
        />
      </div>
    </div>
  );
}
