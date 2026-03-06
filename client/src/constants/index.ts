/**
 * メッセージ定数エクスポート
 * バレルエクスポート
 */
export * from './errorMessages';
export * from './validationMessages';

// Re-export types
export type {
  ErrorMessages,
} from './errorMessages';

export type {
  ValidationMessages,
} from './validationMessages';

// Re-export appVersion (existing)
export { APP_VERSION } from './appVersion';
