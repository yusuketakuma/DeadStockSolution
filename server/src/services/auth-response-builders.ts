import { PHARMACY_VERIFICATION_REQUEST_TYPE } from '../services/pharmacy-verification-service';

type MessageResponse = { message: string };
type ErrorResponse = { error: string };
type CsrfTokenResponse = { csrfToken: string };
type ValidationErrorResponse = { errors: unknown[] };

type LoginResponse = {
  id: number;
  email: string;
  name: string;
  prefecture: string;
  isAdmin: boolean | null;
};

type PasswordResetResponse = MessageResponse & {
  token?: string;
};

type RegistrationRejectionResponse = {
  error: string;
  screening: {
    score: number;
    mismatches: unknown[];
    reviewId: number;
  };
};

type RegistrationSuccessResponse = {
  message: string;
  verificationStatus: 'pending_verification';
  pharmacyId: number;
};

function buildErrorResponse(error: string): ErrorResponse {
  return { error };
}

function buildMessageResponse(message: string): MessageResponse {
  return { message };
}

export function buildLoginResponse(pharmacy: {
  id: number;
  email: string;
  name: string;
  prefecture: string;
  isAdmin: boolean | null;
}): LoginResponse {
  return {
    id: pharmacy.id,
    email: pharmacy.email,
    name: pharmacy.name,
    prefecture: pharmacy.prefecture,
    isAdmin: pharmacy.isAdmin,
  };
}

export function buildPasswordResetResponse(
  shouldExposeToken: boolean,
  result?: { token: string; pharmacyName: string } | null,
): PasswordResetResponse {
  if (!shouldExposeToken || !result) {
    return buildMessageResponse('パスワードリセットの手続きを受け付けました');
  }

  return {
    ...buildMessageResponse('パスワードリセットの手続きを受け付けました'),
    token: result.token,
  };
}

export function buildPasswordResetCompleteResponse(): MessageResponse {
  return buildMessageResponse('パスワードをリセットしました。新しいパスワードでログインしてください');
}

export function buildCsrfTokenResponse(token: string): CsrfTokenResponse {
  return { csrfToken: token };
}

export function buildLogoutResponse(): MessageResponse {
  return buildMessageResponse('ログアウトしました');
}

export function buildUserNotFoundResponse(): ErrorResponse {
  return buildErrorResponse('ユーザーが見つかりません');
}

export function buildTestLoginDisabledResponse(): ErrorResponse {
  return buildErrorResponse('テストログインは無効です');
}

export function buildEmailAlreadyRegisteredResponse(): ErrorResponse {
  return buildErrorResponse('このメールアドレスは既に登録されています');
}

export function buildLicenseAlreadyRegisteredResponse(): ErrorResponse {
  return buildErrorResponse('この薬局開設許可番号は既に登録されています');
}

export function buildInvalidAddressResponse(): { errors: Array<{ field: 'address'; message: string }> } {
  return {
    errors: [{ field: 'address', message: '住所から位置情報を特定できませんでした。正しい住所を入力してください' }],
  };
}

export function buildInvalidResetTokenResponse(): ErrorResponse {
  return buildErrorResponse('リセットトークンが無効です');
}

export function buildInvalidPasswordResetResponse(): ErrorResponse {
  return buildErrorResponse('リセットトークンが無効または期限切れです');
}

export function buildInactiveAccountResponse(): ErrorResponse {
  return buildErrorResponse('このアカウントは無効になっています');
}

export function buildInvalidCredentialsResponse(): ErrorResponse {
  return buildErrorResponse('メールアドレスまたはパスワードが正しくありません');
}

export function buildValidationErrorResponse(errors: unknown[]): ValidationErrorResponse {
  return { errors };
}

export function buildRegistrationRejectionResponse(
  screening: { screeningScore: number; mismatches: unknown[] },
  reviewId: number,
): RegistrationRejectionResponse {
  return {
    error: '登録情報と薬局開設許可証情報が一致しないため、登録できません',
    screening: {
      score: screening.screeningScore,
      mismatches: screening.mismatches,
      reviewId,
    },
  };
}

export function buildRegistrationSuccessResponse(pharmacyId: number): RegistrationSuccessResponse {
  const message = '登録申請を受け付けました。審査完了後にメールでお知らせします。';

  return {
    message,
    verificationStatus: 'pending_verification',
    pharmacyId,
  };
}

export function buildVerificationRequestText(
  pharmacyName: string,
  postalCode: string,
  prefecture: string,
  address: string,
  licenseNumber: string,
): string {
  return JSON.stringify({
    type: PHARMACY_VERIFICATION_REQUEST_TYPE,
    pharmacyName,
    postalCode,
    prefecture,
    address,
    licenseNumber,
    instruction: '薬局機能情報提供制度APIで検索し、薬局名と開設許可番号の一致を確認してください',
  });
}
