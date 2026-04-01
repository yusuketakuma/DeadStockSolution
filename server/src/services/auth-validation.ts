import { emailSchema, passwordSchema } from '../utils/validators';

function getValidationIssueMessage(error: { issues: Array<{ message: string }> } | undefined): string {
  return error?.issues[0]?.message ?? '入力値が不正です';
}

function validateSchemaValue(
  value: string,
  schema: {
    safeParse: (input: string) => { success: boolean; error?: { issues: Array<{ message: string }> } };
  },
): { valid: boolean; error?: string } {
  const result = schema.safeParse(value);
  if (!result.success) {
    return { valid: false, error: getValidationIssueMessage(result.error) };
  }
  return { valid: true };
}

export function validateEmail(email: string): { valid: boolean; error?: string } {
  return validateSchemaValue(email, emailSchema);
}

export function validatePassword(password: string): { valid: boolean; error?: string } {
  return validateSchemaValue(password, passwordSchema);
}

export function validateResetToken(token: string): boolean {
  return token.length > 0 && /^[a-f0-9]{64}$/.test(token);
}

// Password reset request validation
export function validatePasswordResetRequest(email: string): { valid: boolean; error?: string } {
  if (!email) {
    return {
      valid: false,
      error: 'メールアドレスを入力してください',
    };
  }

  const emailValidation = validateEmail(email);
  if (!emailValidation.valid) {
    return { valid: false, error: emailValidation.error };
  }
  return { valid: true };
}

// Password reset confirm validation
export function validatePasswordResetConfirm(token: string, newPassword: string): { valid: boolean; error?: string } {
  if (!validateResetToken(token)) {
    return {
      valid: false,
      error: 'invalid_token',
    };
  }

  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.valid) {
    return { valid: false, error: passwordValidation.error };
  }
  return { valid: true };
}

// Login helper
export function validateLoginInput(email: string, password: string): { valid: boolean; error?: string } {
  if (!email || !password) {
    return {
      valid: false,
      error: 'メールアドレスとパスワードを入力してください',
    };
  }

  return { valid: true };
}
