import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateEmail,
  validatePassword,
  validateLoginInput,
  validatePasswordResetRequest,
  validatePasswordResetConfirm,
  validateResetToken,
  isDependencyServiceUnavailableError,
  extractUniqueViolationConstraint,
  extractErrorCode,
  isMissingTestPharmacyColumnError,
  includesIsTestAccountToken,
  mapLegacyAuthMeRows,
  formatTestPharmacyAccounts,
  normalizePostalCode,
  buildFullAddress,
  getLoginLogAction,
  buildLoginResponse,
  buildPasswordResetResponse,
  buildRegistrationRejectionResponse,
  buildRegistrationSuccessResponse,
  buildVerificationRequestText,
  buildCsrfTokenResponse,
  buildLogoutResponse,
  buildUserNotFoundResponse,
  buildTestLoginDisabledResponse,
  buildEmailAlreadyRegisteredResponse,
  buildLicenseAlreadyRegisteredResponse,
  buildInvalidAddressResponse,
  buildInvalidResetTokenResponse,
  buildInvalidPasswordResetResponse,
  buildInactiveAccountResponse,
  buildInvalidCredentialsResponse,
  buildValidationErrorResponse,
  buildPasswordResetCompleteResponse,
  getCacheControlValue,
  isCacheValid,
  parseIncludePasswordQuery,
  calculatePasswordResetDelay,
  registerLimiter,
  loginLimiter,
  passwordResetLimiter,
  testPharmacyPreviewLimiter,
  TEST_PHARMACY_CACHE_TTL_MS,
  TEST_PHARMACY_PREVIEW_MAX_ACCOUNTS,
  createAuthLimiter,
  setAuthCookie,
} from '../routes/auth-helpers';
import type { TestPharmacyPreviewRow, LegacyAuthMeRow } from '../types';

// -----------------------------------------------------------------------
// validateEmail
// -----------------------------------------------------------------------
describe('validateEmail', () => {
  it('有効なメールアドレスを受け付ける', () => {
    expect(validateEmail('test@example.com')).toEqual({ valid: true });
    expect(validateEmail('user.name+tag@domain.co.jp')).toEqual({ valid: true });
  });

  it('@のないアドレスを拒否する', () => {
    const result = validateEmail('notanemail');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('空文字列を拒否する', () => {
    const result = validateEmail('');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('ドメインのないアドレスを拒否する', () => {
    const result = validateEmail('user@');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('254文字を超えるアドレスを拒否する', () => {
    const longEmail = 'a'.repeat(250) + '@b.com';
    const result = validateEmail(longEmail);
    expect(result.valid).toBe(false);
  });
});

// -----------------------------------------------------------------------
// validatePassword
// -----------------------------------------------------------------------
describe('validatePassword', () => {
  it('8文字以上で英字と数字を含むパスワードを受け付ける', () => {
    expect(validatePassword('Abcdef123')).toEqual({ valid: true });
  });

  it('7文字以下のパスワードを拒否する', () => {
    const result = validatePassword('Abc123');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('8文字');
  });

  it('数字のみのパスワードを拒否する', () => {
    const result = validatePassword('12345678');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('アルファベット');
  });

  it('英字のみのパスワードを拒否する', () => {
    const result = validatePassword('abcdefgh');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('数字');
  });

  it('100文字を超えるパスワードを拒否する', () => {
    const result = validatePassword('A1' + 'a'.repeat(100));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('100文字');
  });

  it('空文字列を拒否する', () => {
    const result = validatePassword('');
    expect(result.valid).toBe(false);
  });
});

// -----------------------------------------------------------------------
// validateLoginInput
// -----------------------------------------------------------------------
describe('validateLoginInput', () => {
  it('メールとパスワードが揃っている場合は有効', () => {
    expect(validateLoginInput('user@example.com', 'password123')).toEqual({ valid: true });
  });

  it('メールが空の場合は無効', () => {
    const result = validateLoginInput('', 'password123');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('パスワードが空の場合は無効', () => {
    const result = validateLoginInput('user@example.com', '');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('両方が空の場合は無効', () => {
    const result = validateLoginInput('', '');
    expect(result.valid).toBe(false);
  });
});

// -----------------------------------------------------------------------
// validatePasswordResetRequest
// -----------------------------------------------------------------------
describe('validatePasswordResetRequest', () => {
  it('有効なメールアドレスを受け付ける', () => {
    expect(validatePasswordResetRequest('user@example.com')).toEqual({ valid: true });
  });

  it('空文字列を拒否する', () => {
    const result = validatePasswordResetRequest('');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('メールアドレスを入力してください');
  });

  it('無効なメール形式を拒否する', () => {
    const result = validatePasswordResetRequest('notanemail');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// -----------------------------------------------------------------------
// validatePasswordResetConfirm
// -----------------------------------------------------------------------
describe('validatePasswordResetConfirm', () => {
  const validToken = 'a'.repeat(64);
  const validPassword = 'NewPass123';

  it('有効なトークンとパスワードを受け付ける', () => {
    expect(validatePasswordResetConfirm(validToken, validPassword)).toEqual({ valid: true });
  });

  it('無効なトークンを拒否する', () => {
    const result = validatePasswordResetConfirm('invalid', validPassword);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_token');
  });

  it('短すぎるパスワードを拒否する', () => {
    const result = validatePasswordResetConfirm(validToken, 'short');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('英字なしパスワードを拒否する', () => {
    const result = validatePasswordResetConfirm(validToken, '12345678');
    expect(result.valid).toBe(false);
  });
});

// -----------------------------------------------------------------------
// validateResetToken
// -----------------------------------------------------------------------
describe('validateResetToken', () => {
  it('64文字の16進数トークンを受け付ける', () => {
    expect(validateResetToken('a'.repeat(64))).toBe(true);
    expect(validateResetToken('f0'.repeat(32))).toBe(true);
  });

  it('空文字列を拒否する', () => {
    expect(validateResetToken('')).toBe(false);
  });

  it('63文字のトークンを拒否する', () => {
    expect(validateResetToken('a'.repeat(63))).toBe(false);
  });

  it('65文字のトークンを拒否する', () => {
    expect(validateResetToken('a'.repeat(65))).toBe(false);
  });

  it('大文字16進数トークンを拒否する（小文字のみ許可）', () => {
    expect(validateResetToken('A'.repeat(64))).toBe(false);
  });

  it('非16進数文字を含むトークンを拒否する', () => {
    expect(validateResetToken('g'.repeat(64))).toBe(false);
  });
});

// -----------------------------------------------------------------------
// extractErrorCode
// -----------------------------------------------------------------------
describe('extractErrorCode', () => {
  it('直接的なcodeプロパティを返す', () => {
    expect(extractErrorCode({ code: 'ECONNREFUSED' })).toBe('ECONNREFUSED');
  });

  it('ネストしたcauseからcodeを取得する', () => {
    expect(extractErrorCode({ cause: { code: 'ETIMEDOUT' } })).toBe('ETIMEDOUT');
  });

  it('深くネストしたcauseからcodeを取得する', () => {
    expect(extractErrorCode({ cause: { cause: { code: 'ENOTFOUND' } } })).toBe('ENOTFOUND');
  });

  it('codeが存在しない場合はnullを返す', () => {
    expect(extractErrorCode({ message: 'some error' })).toBeNull();
  });

  it('nullを渡した場合はnullを返す', () => {
    expect(extractErrorCode(null)).toBeNull();
  });

  it('undefinedを渡した場合はnullを返す', () => {
    expect(extractErrorCode(undefined)).toBeNull();
  });

  it('文字列を渡した場合はnullを返す', () => {
    expect(extractErrorCode('error string')).toBeNull();
  });

  it('空白のみのcodeはnullを返す', () => {
    expect(extractErrorCode({ code: '   ' })).toBeNull();
  });
});

// -----------------------------------------------------------------------
// isDependencyServiceUnavailableError
// -----------------------------------------------------------------------
describe('isDependencyServiceUnavailableError', () => {
  it('ECONNREFUSEDコードを持つエラーを検出する', () => {
    expect(isDependencyServiceUnavailableError({ code: 'ECONNREFUSED' })).toBe(true);
  });

  it('ECONNRESETコードを持つエラーを検出する', () => {
    expect(isDependencyServiceUnavailableError({ code: 'ECONNRESET' })).toBe(true);
  });

  it('ENOTFOUNDコードを持つエラーを検出する', () => {
    expect(isDependencyServiceUnavailableError({ code: 'ENOTFOUND' })).toBe(true);
  });

  it('ETIMEDOUTコードを持つエラーを検出する', () => {
    expect(isDependencyServiceUnavailableError({ code: 'ETIMEDOUT' })).toBe(true);
  });

  it('小文字のコードでも検出する（大文字化処理）', () => {
    expect(isDependencyServiceUnavailableError({ code: 'econnrefused' })).toBe(true);
  });

  it('"connection refused"を含むメッセージを検出する', () => {
    expect(isDependencyServiceUnavailableError({ message: 'connection refused by host' })).toBe(true);
  });

  it('"timeout"を含むメッセージを検出する', () => {
    expect(isDependencyServiceUnavailableError({ message: 'request timeout occurred' })).toBe(true);
  });

  it('"service unavailable"を含むメッセージを検出する', () => {
    expect(isDependencyServiceUnavailableError({ message: 'Service Unavailable' })).toBe(true);
  });

  it('"fetch failed"を含むメッセージを検出する', () => {
    expect(isDependencyServiceUnavailableError({ message: 'fetch failed to connect' })).toBe(true);
  });

  it('"postgres url is not configured"を含むメッセージを検出する', () => {
    expect(isDependencyServiceUnavailableError({ message: 'postgres url is not configured' })).toBe(true);
  });

  it('通常のエラーは検出しない', () => {
    expect(isDependencyServiceUnavailableError({ message: 'invalid input' })).toBe(false);
  });

  it('nullを渡した場合はfalse', () => {
    expect(isDependencyServiceUnavailableError(null)).toBe(false);
  });

  it('ネストしたcauseのメッセージを検出する', () => {
    expect(isDependencyServiceUnavailableError({
      message: 'outer error',
      cause: { message: 'connection refused inner' },
    })).toBe(true);
  });
});

// -----------------------------------------------------------------------
// extractUniqueViolationConstraint
// -----------------------------------------------------------------------
describe('extractUniqueViolationConstraint', () => {
  it('code=23505でconstraintを返す', () => {
    expect(extractUniqueViolationConstraint({ code: '23505', constraint: 'pharmacies_email_unique' }))
      .toBe('pharmacies_email_unique');
  });

  it('constraintを小文字で返す', () => {
    expect(extractUniqueViolationConstraint({ code: '23505', constraint: 'Pharmacies_Email_Unique' }))
      .toBe('pharmacies_email_unique');
  });

  it('constraintがない場合はmessageからパースする', () => {
    const err = { code: '23505', constraint: '', message: 'duplicate key value violates unique constraint "pharmacies_email_key"' };
    expect(extractUniqueViolationConstraint(err)).toBe('pharmacies_email_key');
  });

  it('code=23505以外のコードではnullを返す', () => {
    expect(extractUniqueViolationConstraint({ code: '23502', constraint: 'some_constraint' })).toBeNull();
  });

  it('nullを渡した場合はnullを返す', () => {
    expect(extractUniqueViolationConstraint(null)).toBeNull();
  });

  it('非オブジェクトを渡した場合はnullを返す', () => {
    expect(extractUniqueViolationConstraint('error')).toBeNull();
    expect(extractUniqueViolationConstraint(42)).toBeNull();
  });
});

// -----------------------------------------------------------------------
// isMissingTestPharmacyColumnError / includesIsTestAccountToken
// -----------------------------------------------------------------------
describe('isMissingTestPharmacyColumnError', () => {
  it('code=42703のエラーを検出する', () => {
    expect(isMissingTestPharmacyColumnError({ code: '42703' })).toBe(true);
  });

  it('"is_test_account"を含むメッセージを検出する', () => {
    expect(isMissingTestPharmacyColumnError({ message: 'column "is_test_account" does not exist' })).toBe(true);
  });

  it('"test_account_password"を含むメッセージを検出する', () => {
    expect(isMissingTestPharmacyColumnError({ message: 'unknown column test_account_password' })).toBe(true);
  });

  it('無関係なエラーを検出しない', () => {
    expect(isMissingTestPharmacyColumnError({ code: '23505', message: 'duplicate key' })).toBe(false);
  });
});

describe('includesIsTestAccountToken', () => {
  it('"is_test_account"を含むエラーを検出する', () => {
    expect(includesIsTestAccountToken({ message: 'column is_test_account missing' })).toBe(true);
  });

  it('"test_account_password"を含むエラーを検出する', () => {
    expect(includesIsTestAccountToken({ message: 'test_account_password not found' })).toBe(true);
  });

  it('関係ないメッセージは検出しない', () => {
    expect(includesIsTestAccountToken({ message: 'some other error' })).toBe(false);
  });
});

// -----------------------------------------------------------------------
// mapLegacyAuthMeRows
// -----------------------------------------------------------------------
describe('mapLegacyAuthMeRows', () => {
  it('LegacyAuthMeRowにisTestAccount=falseを付与する', () => {
    const rows: LegacyAuthMeRow[] = [
      {
        id: 1,
        email: 'a@example.com',
        name: '薬局A',
        postalCode: '1234567',
        address: '東京都新宿区',
        phone: '03-0000-0000',
        fax: '03-0000-0001',
        licenseNumber: 'LIC001',
        prefecture: '東京都',
        isAdmin: false,
      },
    ];

    const result = mapLegacyAuthMeRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0].isTestAccount).toBe(false);
    expect(result[0].email).toBe('a@example.com');
  });

  it('空配列を渡した場合は空配列を返す', () => {
    expect(mapLegacyAuthMeRows([])).toEqual([]);
  });
});

// -----------------------------------------------------------------------
// formatTestPharmacyAccounts
// -----------------------------------------------------------------------
describe('formatTestPharmacyAccounts', () => {
  const rows: TestPharmacyPreviewRow[] = [
    { id: 1, name: '薬局A', email: 'a@example.com', prefecture: '東京都', password: 'pass123' },
    { id: 2, name: '薬局B', email: 'b@example.com', prefecture: '大阪府', password: null },
  ];

  it('includePassword=trueの場合パスワードを含める', () => {
    const result = formatTestPharmacyAccounts(rows, true);
    expect(result[0].password).toBe('pass123');
    expect(result[1].password).toBe('');
  });

  it('includePassword=falseの場合パスワードを空文字にする', () => {
    const result = formatTestPharmacyAccounts(rows, false);
    expect(result[0].password).toBe('');
    expect(result[1].password).toBe('');
  });

  it('idとname等の基本フィールドを正しくマップする', () => {
    const result = formatTestPharmacyAccounts(rows, false);
    expect(result[0]).toMatchObject({ id: 1, name: '薬局A', email: 'a@example.com', prefecture: '東京都' });
  });
});

// -----------------------------------------------------------------------
// normalizePostalCode
// -----------------------------------------------------------------------
describe('normalizePostalCode', () => {
  it('ハイフンを除去する', () => {
    expect(normalizePostalCode('123-4567')).toBe('1234567');
  });

  it('全角ハイフンを除去する', () => {
    expect(normalizePostalCode('123ー4567')).toBe('1234567');
    expect(normalizePostalCode('123－4567')).toBe('1234567');
  });

  it('スペースを除去する', () => {
    expect(normalizePostalCode('123 4567')).toBe('1234567');
  });

  it('ハイフンなしの7桁はそのまま返す', () => {
    expect(normalizePostalCode('1234567')).toBe('1234567');
  });
});

// -----------------------------------------------------------------------
// buildFullAddress
// -----------------------------------------------------------------------
describe('buildFullAddress', () => {
  it('都道府県と住所を結合する', () => {
    expect(buildFullAddress('東京都', '新宿区1-1-1')).toBe('東京都新宿区1-1-1');
  });

  it('空文字列を渡した場合も結合する', () => {
    expect(buildFullAddress('', '住所')).toBe('住所');
    expect(buildFullAddress('東京都', '')).toBe('東京都');
  });
});

// -----------------------------------------------------------------------
// getLoginLogAction
// -----------------------------------------------------------------------
describe('getLoginLogAction', () => {
  it('isAdmin=trueの場合admin_loginを返す', () => {
    expect(getLoginLogAction(true)).toBe('admin_login');
  });

  it('isAdmin=falseの場合loginを返す', () => {
    expect(getLoginLogAction(false)).toBe('login');
  });

  it('isAdmin=nullの場合loginを返す', () => {
    expect(getLoginLogAction(null)).toBe('login');
  });
});

// -----------------------------------------------------------------------
// buildLoginResponse
// -----------------------------------------------------------------------
describe('buildLoginResponse', () => {
  it('ログインレスポンスオブジェクトを構築する', () => {
    const pharmacy = { id: 1, email: 'a@example.com', name: '薬局A', prefecture: '東京都', isAdmin: false as boolean | null };
    const result = buildLoginResponse(pharmacy);
    expect(result).toEqual({ id: 1, email: 'a@example.com', name: '薬局A', prefecture: '東京都', isAdmin: false });
  });

  it('isAdmin=nullも含める', () => {
    const pharmacy = { id: 2, email: 'b@example.com', name: '薬局B', prefecture: '大阪府', isAdmin: null as boolean | null };
    const result = buildLoginResponse(pharmacy);
    expect(result.isAdmin).toBeNull();
  });
});

// -----------------------------------------------------------------------
// buildPasswordResetResponse
// -----------------------------------------------------------------------
describe('buildPasswordResetResponse', () => {
  it('デフォルトメッセージを含むレスポンスを返す', () => {
    const result = buildPasswordResetResponse(false);
    expect(result.message).toBe('パスワードリセットの手続きを受け付けました');
    expect(result).not.toHaveProperty('token');
  });

  it('shouldExposeToken=trueかつresultがある場合はtokenを含める', () => {
    const result = buildPasswordResetResponse(true, { token: 'abc123', pharmacyName: '薬局A' });
    expect(result.token).toBe('abc123');
  });

  it('shouldExposeToken=trueでもresultがnullの場合はtokenを含めない', () => {
    const result = buildPasswordResetResponse(true, null);
    expect(result).not.toHaveProperty('token');
  });

  it('shouldExposeToken=falseの場合はresultがあってもtokenを含めない', () => {
    const result = buildPasswordResetResponse(false, { token: 'abc123', pharmacyName: '薬局A' });
    expect(result).not.toHaveProperty('token');
  });
});

// -----------------------------------------------------------------------
// buildRegistrationRejectionResponse
// -----------------------------------------------------------------------
describe('buildRegistrationRejectionResponse', () => {
  it('正しい拒否レスポンスを構築する', () => {
    const screening = { screeningScore: 40, mismatches: [{ field: 'name' }] };
    const result = buildRegistrationRejectionResponse(screening, 99);
    expect(result.error).toContain('登録できません');
    expect(result.screening.score).toBe(40);
    expect(result.screening.reviewId).toBe(99);
    expect(result.screening.mismatches).toEqual([{ field: 'name' }]);
  });
});

// -----------------------------------------------------------------------
// buildRegistrationSuccessResponse
// -----------------------------------------------------------------------
describe('buildRegistrationSuccessResponse', () => {
  it('正しい成功レスポンスを構築する', () => {
    const result = buildRegistrationSuccessResponse(42);
    expect(result.message).toContain('登録申請を受け付けました');
    expect(result.verificationStatus).toBe('pending_verification');
    expect(result.pharmacyId).toBe(42);
  });
});

// -----------------------------------------------------------------------
// buildVerificationRequestText
// -----------------------------------------------------------------------
describe('buildVerificationRequestText', () => {
  it('正しいJSON文字列を生成する', () => {
    const text = buildVerificationRequestText('薬局A', '1234567', '東京都', '新宿区1-1', 'LIC001');
    const parsed = JSON.parse(text);
    expect(parsed.pharmacyName).toBe('薬局A');
    expect(parsed.postalCode).toBe('1234567');
    expect(parsed.prefecture).toBe('東京都');
    expect(parsed.licenseNumber).toBe('LIC001');
    expect(parsed.instruction).toBeTruthy();
  });
});

// -----------------------------------------------------------------------
// Various simple response builders
// -----------------------------------------------------------------------
describe('レスポンスビルダー関数群', () => {
  it('buildCsrfTokenResponseはcsrfTokenを含む', () => {
    expect(buildCsrfTokenResponse('token123')).toEqual({ csrfToken: 'token123' });
  });

  it('buildLogoutResponseは正しいメッセージを返す', () => {
    expect(buildLogoutResponse()).toEqual({ message: 'ログアウトしました' });
  });

  it('buildUserNotFoundResponseは正しいエラーを返す', () => {
    expect(buildUserNotFoundResponse()).toEqual({ error: 'ユーザーが見つかりません' });
  });

  it('buildTestLoginDisabledResponseは正しいエラーを返す', () => {
    expect(buildTestLoginDisabledResponse()).toEqual({ error: 'テストログインは無効です' });
  });

  it('buildEmailAlreadyRegisteredResponseは正しいエラーを返す', () => {
    expect(buildEmailAlreadyRegisteredResponse()).toEqual({ error: 'このメールアドレスは既に登録されています' });
  });

  it('buildLicenseAlreadyRegisteredResponseは正しいエラーを返す', () => {
    expect(buildLicenseAlreadyRegisteredResponse()).toEqual({ error: 'この薬局開設許可番号は既に登録されています' });
  });

  it('buildInvalidAddressResponseはerrorsフィールドを持つ', () => {
    const result = buildInvalidAddressResponse();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('address');
  });

  it('buildInvalidResetTokenResponseは正しいエラーを返す', () => {
    expect(buildInvalidResetTokenResponse()).toEqual({ error: 'リセットトークンが無効です' });
  });

  it('buildInvalidPasswordResetResponseは正しいエラーを返す', () => {
    expect(buildInvalidPasswordResetResponse()).toEqual({ error: 'リセットトークンが無効または期限切れです' });
  });

  it('buildInactiveAccountResponseは正しいエラーを返す', () => {
    expect(buildInactiveAccountResponse()).toEqual({ error: 'このアカウントは無効になっています' });
  });

  it('buildInvalidCredentialsResponseは正しいエラーを返す', () => {
    expect(buildInvalidCredentialsResponse()).toEqual({ error: 'メールアドレスまたはパスワードが正しくありません' });
  });

  it('buildValidationErrorResponseはerrorsを含む', () => {
    const errors = [{ field: 'email', message: 'invalid' }];
    expect(buildValidationErrorResponse(errors)).toEqual({ errors });
  });

  it('buildPasswordResetCompleteResponseは正しいメッセージを返す', () => {
    expect(buildPasswordResetCompleteResponse()).toEqual({
      message: 'パスワードをリセットしました。新しいパスワードでログインしてください',
    });
  });
});

// -----------------------------------------------------------------------
// getCacheControlValue
// -----------------------------------------------------------------------
describe('getCacheControlValue', () => {
  it('includePassword=trueの場合no-storeを返す', () => {
    expect(getCacheControlValue(true)).toBe('no-store');
  });

  it('includePassword=falseの場合private max-ageを返す', () => {
    expect(getCacheControlValue(false)).toBe('private, max-age=60');
  });
});

// -----------------------------------------------------------------------
// isCacheValid
// -----------------------------------------------------------------------
describe('isCacheValid', () => {
  it('cacheがnullの場合はfalseを返す', () => {
    expect(isCacheValid(null)).toBe(false);
  });

  it('expiresAtが未来の場合はtrueを返す', () => {
    const cache = { expiresAt: Date.now() + 60_000, rows: [] };
    expect(isCacheValid(cache)).toBe(true);
  });

  it('expiresAtが過去の場合はfalseを返す', () => {
    const cache = { expiresAt: Date.now() - 1, rows: [] };
    expect(isCacheValid(cache)).toBe(false);
  });
});

// -----------------------------------------------------------------------
// parseIncludePasswordQuery
// -----------------------------------------------------------------------
describe('parseIncludePasswordQuery', () => {
  beforeEach(() => {
    delete process.env.EXPOSE_TEST_PHARMACY_PASSWORDS;
  });

  it('EXPOSE_TEST_PHARMACY_PASSWORDS未設定の場合は常にfalse', () => {
    expect(parseIncludePasswordQuery('1')).toBe(false);
    expect(parseIncludePasswordQuery('true')).toBe(false);
  });

  it('EXPOSE_TEST_PHARMACY_PASSWORDS=trueで"1"の場合はtrue', () => {
    process.env.EXPOSE_TEST_PHARMACY_PASSWORDS = 'true';
    expect(parseIncludePasswordQuery('1')).toBe(true);
  });

  it('EXPOSE_TEST_PHARMACY_PASSWORDS=trueで"true"の場合はtrue', () => {
    process.env.EXPOSE_TEST_PHARMACY_PASSWORDS = 'true';
    expect(parseIncludePasswordQuery('true')).toBe(true);
  });

  it('EXPOSE_TEST_PHARMACY_PASSWORDS=trueでも"0"の場合はfalse', () => {
    process.env.EXPOSE_TEST_PHARMACY_PASSWORDS = 'true';
    expect(parseIncludePasswordQuery('0')).toBe(false);
  });

  it('EXPOSE_TEST_PHARMACY_PASSWORDS=trueでもundefinedの場合はfalse', () => {
    process.env.EXPOSE_TEST_PHARMACY_PASSWORDS = 'true';
    expect(parseIncludePasswordQuery(undefined)).toBe(false);
  });
});

// -----------------------------------------------------------------------
// calculatePasswordResetDelay
// -----------------------------------------------------------------------
describe('calculatePasswordResetDelay', () => {
  it('指定時間以上経過している場合はsleepしない', async () => {
    const start = Date.now() - 1000;
    // 経過時間 > targetMs なので sleep は不要、即時完了するはず
    await expect(calculatePasswordResetDelay(start, 100, 0)).resolves.toBeUndefined();
  });

  it('jitterMs=0の場合はminResponseMs分だけ待機する（TEST環境は0ms）', async () => {
    // NODE_ENV=test ではPASSWORD_RESET_MIN_RESPONSE_MS=0なので
    // テスト環境では即時完了する
    const start = Date.now();
    await expect(calculatePasswordResetDelay(start, 0, 0)).resolves.toBeUndefined();
  });
});

// -----------------------------------------------------------------------
// Rate limiters
// -----------------------------------------------------------------------
describe('レートリミッター設定', () => {
  it('registerLimiterがエクスポートされている', () => {
    expect(registerLimiter).toBeDefined();
    expect(typeof registerLimiter).toBe('function');
  });

  it('loginLimiterがエクスポートされている', () => {
    expect(loginLimiter).toBeDefined();
    expect(typeof loginLimiter).toBe('function');
  });

  it('passwordResetLimiterがエクスポートされている', () => {
    expect(passwordResetLimiter).toBeDefined();
    expect(typeof passwordResetLimiter).toBe('function');
  });

  it('testPharmacyPreviewLimiterがエクスポートされている', () => {
    expect(testPharmacyPreviewLimiter).toBeDefined();
    expect(typeof testPharmacyPreviewLimiter).toBe('function');
  });
});

// -----------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------
describe('定数', () => {
  it('TEST_PHARMACY_CACHE_TTL_MSは60000ミリ秒', () => {
    expect(TEST_PHARMACY_CACHE_TTL_MS).toBe(60_000);
  });

  it('TEST_PHARMACY_PREVIEW_MAX_ACCOUNTSは5', () => {
    expect(TEST_PHARMACY_PREVIEW_MAX_ACCOUNTS).toBe(5);
  });
});

// -----------------------------------------------------------------------
// createAuthLimiter
// -----------------------------------------------------------------------
describe('createAuthLimiter', () => {
  it('ミドルウェア関数を返す', () => {
    const limiter = createAuthLimiter(5, 'Too many requests');
    expect(typeof limiter).toBe('function');
  });
});

// -----------------------------------------------------------------------
// setAuthCookie
// -----------------------------------------------------------------------
describe('setAuthCookie', () => {
  it('本番環境ではsecure=trueでcookieをセットする', () => {
    const cookieMock = vi.fn();
    const resMock = { cookie: cookieMock } as unknown as Parameters<typeof setAuthCookie>[0];
    setAuthCookie(resMock, 'mytoken', true);
    expect(cookieMock).toHaveBeenCalledWith('token', 'mytoken', expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    }));
  });

  it('非本番環境ではsecure=falseでcookieをセットする', () => {
    const cookieMock = vi.fn();
    const resMock = { cookie: cookieMock } as unknown as Parameters<typeof setAuthCookie>[0];
    setAuthCookie(resMock, 'mytoken', false);
    expect(cookieMock).toHaveBeenCalledWith('token', 'mytoken', expect.objectContaining({
      secure: false,
    }));
  });
});
