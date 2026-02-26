import { useId, type ChangeEvent, type ReactNode } from 'react';
import { Form } from 'react-bootstrap';

export interface AppSelectOption {
  value: string;
  label: string;
}

interface AppSelectProps {
  value: string;
  onChange?: (value: string) => void;
  onChangeEvent?: (event: ChangeEvent<HTMLSelectElement>) => void;
  ariaLabel?: string;
  options?: AppSelectOption[];
  placeholder?: string;
  label?: string;
  controlId?: string;
  size?: 'sm' | 'lg';
  className?: string;
  required?: boolean;
  disabled?: boolean;
  isInvalid?: boolean;
  errorText?: string;
  helpText?: string;
  children?: ReactNode;
}

function SelectBody({
  selectId,
  value,
  onChange,
  onChangeEvent,
  ariaLabel,
  options,
  placeholder,
  size,
  className,
  required,
  disabled,
  isInvalid,
  errorText,
  helpText,
  children,
  describedBy,
  errorId,
  helpId,
}: Omit<AppSelectProps, 'label' | 'controlId'> & {
  selectId: string;
  describedBy?: string;
  errorId?: string;
  helpId?: string;
}) {
  return (
    <>
      <Form.Select
        id={selectId}
        value={value}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={isInvalid || undefined}
        size={size}
        className={className}
        required={required}
        disabled={disabled}
        isInvalid={isInvalid}
        onChange={(e) => {
          onChange?.(e.target.value);
          onChangeEvent?.(e);
        }}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options?.map((opt) => (
          <option key={`${opt.value}-${opt.label}`} value={opt.value}>{opt.label}</option>
        ))}
        {children}
      </Form.Select>
      {errorText && <Form.Control.Feedback id={errorId} type="invalid">{errorText}</Form.Control.Feedback>}
      {helpText && <Form.Text id={helpId} className="text-muted">{helpText}</Form.Text>}
    </>
  );
}

export default function AppSelect({
  ariaLabel,
  label,
  controlId,
  ...rest
}: AppSelectProps) {
  const generatedId = useId().replace(/:/g, '');
  const selectId = controlId ?? `app-select-${generatedId}`;
  const resolvedAriaLabel = ariaLabel ?? label ?? rest.placeholder ?? '選択';
  const errorId = rest.errorText ? `${selectId}-error` : undefined;
  const helpId = rest.helpText ? `${selectId}-help` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(' ') || undefined;

  if (!label) {
    return (
      <SelectBody
        {...rest}
        selectId={selectId}
        ariaLabel={resolvedAriaLabel}
        describedBy={describedBy}
        errorId={errorId}
        helpId={helpId}
      />
    );
  }

  return (
    <Form.Group>
      <Form.Label htmlFor={selectId}>{label}</Form.Label>
      <SelectBody
        {...rest}
        selectId={selectId}
        ariaLabel={resolvedAriaLabel}
        describedBy={describedBy}
        errorId={errorId}
        helpId={helpId}
      />
    </Form.Group>
  );
}
