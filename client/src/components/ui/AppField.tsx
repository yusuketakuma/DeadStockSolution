import { useId, type ChangeEvent, type HTMLAttributes } from 'react';
import { Form } from 'react-bootstrap';

interface AppFieldProps {
  controlId?: string;
  label: string;
  value: string;
  onChange?: (value: string, event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
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
  const generatedId = useId().replace(/:/g, '');
  const inputId = controlId ?? `app-field-${generatedId}`;
  const helpId = helpText ? `${inputId}-help` : undefined;
  const errorId = errorText ? `${inputId}-error` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(' ') || undefined;

  return (
    <Form.Group className={className}>
      <Form.Label className={labelClassName} htmlFor={inputId}>{label}</Form.Label>
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
          isInvalid={isInvalid}
          aria-invalid={isInvalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange?.(event.target.value, event)}
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
          isInvalid={isInvalid}
          aria-invalid={isInvalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange?.(event.target.value, event)}
        />
      )}
      {errorText && <Form.Control.Feedback id={errorId} type="invalid">{errorText}</Form.Control.Feedback>}
      {helpText && <Form.Text id={helpId} className="text-muted">{helpText}</Form.Text>}
    </Form.Group>
  );
}
