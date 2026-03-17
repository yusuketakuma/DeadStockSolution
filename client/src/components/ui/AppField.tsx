import { useId, useState, type ChangeEvent, type HTMLAttributes } from 'react';
import { Form } from 'react-bootstrap';

interface AppFieldProps {
  controlId?: string;
  label: string;
  value: string;
  onChange?: (value: string, event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  validate?: (value: string) => string | null;
  className?: string;
  controlClassName?: string;
  labelClassName?: string;
  type?: string;
  as?: 'input' | 'textarea';
  rows?: number;
  autoComplete?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  enterKeyHint?: HTMLAttributes<HTMLInputElement>['enterKeyHint'];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  maxLength?: number;
  minLength?: number;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  helpText?: string;
  isInvalid?: boolean;
  errorText?: string;
}

export default function AppField({
  controlId,
  label,
  value,
  onChange,
  validate,
  className,
  controlClassName,
  labelClassName,
  type = 'text',
  as = 'input',
  rows,
  autoComplete,
  inputMode,
  enterKeyHint,
  placeholder,
  required,
  disabled,
  maxLength,
  minLength,
  min,
  max,
  step,
  helpText,
  isInvalid,
  errorText,
}: AppFieldProps) {
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleBlur = () => {
    if (validate) {
      setValidationError(validate(value));
    }
  };

  const generatedId = useId().replace(/:/g, '');
  const inputId = controlId ?? `app-field-${generatedId}`;
  const helpId = helpText ? `${inputId}-help` : undefined;
  // 外部から渡された errorText を優先し、なければバリデーションエラーを使う
  const activeError = errorText ?? validationError ?? undefined;
  const errorId = activeError ? `${inputId}-error` : undefined;
  const activeIsInvalid = isInvalid || (validationError !== null && !errorText);
  const describedBy = [errorId, helpId].filter(Boolean).join(' ') || undefined;

  return (
    <Form.Group className={className}>
      <Form.Label className={labelClassName} htmlFor={inputId}>
        {label}
        {required && <span className="text-danger ms-1">*</span>}
      </Form.Label>
      {as === 'textarea' ? (
        <Form.Control
          id={inputId}
          as="textarea"
          className={controlClassName}
          rows={rows}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          enterKeyHint={enterKeyHint}
          required={required}
          disabled={disabled}
          maxLength={maxLength}
          minLength={minLength}
          min={min}
          max={max}
          step={step}
          isInvalid={activeIsInvalid}
          aria-invalid={activeIsInvalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange?.(event.target.value, event)}
          onBlur={handleBlur}
        />
      ) : (
        <Form.Control
          id={inputId}
          type={type}
          className={controlClassName}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          enterKeyHint={enterKeyHint}
          required={required}
          disabled={disabled}
          maxLength={maxLength}
          minLength={minLength}
          min={min}
          max={max}
          step={step}
          isInvalid={activeIsInvalid}
          aria-invalid={activeIsInvalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange?.(event.target.value, event)}
          onBlur={handleBlur}
        />
      )}
      {activeError && <Form.Control.Feedback id={errorId} type="invalid">{activeError}</Form.Control.Feedback>}
      {helpText && <Form.Text id={helpId} className="text-muted">{helpText}</Form.Text>}
    </Form.Group>
  );
}
