import { z } from 'zod';
import { isValidPrefecture } from './prefectures';

export interface ValidationError {
  field: string;
  message: string;
}

const trimmedText = z.string().trim();

// Email: proper format with @ and domain
const emailSchema = trimmedText
  .min(1, 'メールアドレスを入力してください')
  .email('有効なメールアドレスを入力してください')
  .max(254, 'メールアドレスが長すぎます');

// Password: 8+ chars, at least one letter and one digit (login-time validation)
const passwordSchema = z.string()
  .min(8, 'パスワードは8文字以上で入力してください')
  .max(100, 'パスワードは100文字以下で入力してください')
  .regex(/[a-zA-Z]/, 'パスワードにはアルファベットを含めてください')
  .regex(/\d/, 'パスワードには数字を含めてください');

// Strong password: 10+ chars, uppercase, lowercase, digit, symbol (new registrations)
// 3省2ガイドライン準拠: 英大文字・英小文字・数字・記号をすべて含む10文字以上
const strongPasswordSchema = z.string()
  .min(10, 'パスワードは10文字以上で入力してください')
  .max(100, 'パスワードは100文字以下で入力してください')
  .regex(/[A-Z]/, 'パスワードには大文字アルファベットを含めてください')
  .regex(/[a-z]/, 'パスワードには小文字アルファベットを含めてください')
  .regex(/\d/, 'パスワードには数字を含めてください')
  .regex(/[!@#$%^&*()\-_=+\[\]{}|;:'",.<>?/`~\\]/, 'パスワードには記号を含めてください');

// Phone / FAX: Japanese phone number patterns
const phoneSchema = trimmedText
  .min(1, '電話番号を入力してください')
  .regex(/^[\d\-ー－() ]{8,20}$/, '有効な電話番号を入力してください');

const faxSchema = trimmedText
  .min(1, 'FAX番号を入力してください')
  .regex(/^[\d\-ー－() ]{8,20}$/, '有効なFAX番号を入力してください');

// Postal code: 7 digits (allow hyphens)
const postalCodeSchema = trimmedText
  .min(1, '郵便番号を入力してください')
  .refine((val) => {
    const normalized = val.replace(/[-ー－\s]/g, '');
    return /^\d{7}$/.test(normalized);
  }, '郵便番号は7桁の数字で入力してください');

const registrationSchema = z.object({
  email: emailSchema,
  password: strongPasswordSchema,
  name: trimmedText.min(1, '薬局名を入力してください').max(100, '薬局名は100文字以下で入力してください'),
  postalCode: postalCodeSchema,
  address: trimmedText.min(1, '住所を入力してください').max(255, '住所は255文字以下で入力してください'),
  phone: phoneSchema,
  fax: faxSchema,
  licenseNumber: trimmedText.min(1, '薬局開設許可番号を入力してください').max(50, '薬局開設許可番号が長すぎます'),
  permitLicenseNumber: trimmedText.min(1, '許可証記載の許可番号を入力してください').max(50, '許可証記載の許可番号が長すぎます'),
  permitPharmacyName: trimmedText.min(1, '許可証記載の薬局名を入力してください').max(100, '許可証記載の薬局名が長すぎます'),
  permitAddress: trimmedText.min(1, '許可証記載の所在地を入力してください').max(255, '許可証記載の所在地が長すぎます'),
  prefecture: trimmedText.min(1, '都道府県を選択してください').refine(
    (val) => isValidPrefecture(val),
    '有効な都道府県を選択してください'
  ),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'パスワードを入力してください'),
});

function zodToValidationErrors(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }): ValidationError[] {
  if (result.success || !result.error) return [];
  return result.error.issues.map((issue) => ({
    field: issue.path[0]?.toString() || 'unknown',
    message: issue.message,
  }));
}

export function validateRegistration(body: Record<string, unknown>): ValidationError[] {
  return zodToValidationErrors(registrationSchema.safeParse(body));
}

export function validateLogin(body: Record<string, unknown>): ValidationError[] {
  return zodToValidationErrors(loginSchema.safeParse(body));
}

/** WorkOS onboarding 用: email/password を除いた薬局情報バリデーション */
const onboardingRegistrationSchema = registrationSchema.omit({ email: true, password: true });

export function validateOnboardingRegistration(body: Record<string, unknown>): ValidationError[] {
  return zodToValidationErrors(onboardingRegistrationSchema.safeParse(body));
}

export { emailSchema, passwordSchema, strongPasswordSchema, registrationSchema, loginSchema };

// Camera scan request schemas
export const cameraResolveSchema = z.object({
  rawCode: z.string().min(1, '読取コードを入力してください'),
});

export const cameraConfirmSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())).min(1, '登録する行がありません').max(200, '一度に登録できる件数は200件までです'),
});

export const cameraManualCandidatesSchema = z.object({
  q: z.string().trim().min(2, '検索キーワードは2文字以上で入力してください').max(80, '検索キーワードは80文字以内で入力してください'),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// Type helpers for validated bodies
export type CameraResolveBody = z.infer<typeof cameraResolveSchema>;
export type CameraConfirmBody = z.infer<typeof cameraConfirmSchema>;
export type CameraManualCandidatesQuery = z.infer<typeof cameraManualCandidatesSchema>;

// Prescription inventory search schemas
export const inventorySearchDrugKeySchema = z.object({
  drugMasterId: z.number().int().positive(),
  genericName: z.string().max(200).nullable(),
  specification: z.string().max(100).nullable(),
});

export const inventorySearchSchema = z.object({
  drugKeys: z
    .array(inventorySearchDrugKeySchema)
    .min(1, '薬剤を1つ以上選択してください')
    .max(10, '薬剤は10品目まで検索できます'),
  filters: z.object({
    groupOnly: z.boolean().default(false),
    openOnly: z.boolean().default(false),
    favoritePriority: z.boolean().default(false),
  }).default({ groupOnly: false, openOnly: false, favoritePriority: false }),
  coordinates: z.object({
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
  }).nullable().default(null),
});
