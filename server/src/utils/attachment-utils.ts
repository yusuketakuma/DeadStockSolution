export const MAX_ATTACHMENT_SIZE_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENT_FILES = 3;
export const ATTACHMENT_ALLOWED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.pdf',
  '.txt',
  '.csv',
]);
export const ATTACHMENT_ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
]);

const FALLBACK_ATTACHMENT_NAME = 'attachment';

export function sanitizeAttachmentFileName(rawName: string): string {
  const sanitized = rawName
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
  return (sanitized || FALLBACK_ATTACHMENT_NAME).slice(0, 120);
}

export function encodeAttachmentContent(buffer: Buffer): string {
  return buffer.toString('base64');
}

export function decodeAttachmentContent(contentBase64: string): Buffer {
  return Buffer.from(contentBase64, 'base64');
}

export function parseUploadedFiles(files: Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] } | undefined): Express.Multer.File[] {
  if (!files) {
    return [];
  }
  if (Array.isArray(files)) {
    return files;
  }
  return Object.values(files).flat();
}
