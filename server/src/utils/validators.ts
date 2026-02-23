import { isValidPrefecture } from './prefectures';

export interface ValidationError {
  field: string;
  message: string;
}

export function validateRegistration(body: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!body.email || typeof body.email !== 'string' || !body.email.includes('@')) {
    errors.push({ field: 'email', message: '有効なメールアドレスを入力してください' });
  }

  if (!body.password || typeof body.password !== 'string' || (body.password as string).length < 8) {
    errors.push({ field: 'password', message: 'パスワードは8文字以上で入力してください' });
  }

  if (!body.name || typeof body.name !== 'string' || (body.name as string).trim().length === 0) {
    errors.push({ field: 'name', message: '薬局名を入力してください' });
  }

  if (!body.postalCode || typeof body.postalCode !== 'string') {
    errors.push({ field: 'postalCode', message: '郵便番号を入力してください' });
  } else {
    const normalized = (body.postalCode as string).replace(/[-ー－\s]/g, '');
    if (!/^\d{7}$/.test(normalized)) {
      errors.push({ field: 'postalCode', message: '郵便番号は7桁の数字で入力してください' });
    }
  }

  if (!body.address || typeof body.address !== 'string') {
    errors.push({ field: 'address', message: '住所を入力してください' });
  }

  if (!body.phone || typeof body.phone !== 'string') {
    errors.push({ field: 'phone', message: '電話番号を入力してください' });
  }

  if (!body.fax || typeof body.fax !== 'string') {
    errors.push({ field: 'fax', message: 'FAX番号を入力してください' });
  }

  if (!body.licenseNumber || typeof body.licenseNumber !== 'string') {
    errors.push({ field: 'licenseNumber', message: '薬局開設許可番号を入力してください' });
  }

  if (!body.prefecture || typeof body.prefecture !== 'string' || !isValidPrefecture(body.prefecture as string)) {
    errors.push({ field: 'prefecture', message: '有効な都道府県を選択してください' });
  }

  return errors;
}

export function validateLogin(body: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!body.email || typeof body.email !== 'string') {
    errors.push({ field: 'email', message: 'メールアドレスを入力してください' });
  }

  if (!body.password || typeof body.password !== 'string') {
    errors.push({ field: 'password', message: 'パスワードを入力してください' });
  }

  return errors;
}
