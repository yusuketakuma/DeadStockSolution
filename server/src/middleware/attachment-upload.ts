import { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { createMemoryMultiFileUpload } from './upload-middleware';
import {
  ATTACHMENT_ALLOWED_EXTENSIONS,
  ATTACHMENT_ALLOWED_MIME_TYPES,
  MAX_ATTACHMENT_FILES,
  MAX_ATTACHMENT_SIZE_BYTES,
} from '../utils/attachment-utils';

const attachmentUpload = createMemoryMultiFileUpload({
  maxUploadSize: MAX_ATTACHMENT_SIZE_BYTES,
  maxFiles: MAX_ATTACHMENT_FILES,
  allowedExtensions: ATTACHMENT_ALLOWED_EXTENSIONS,
  allowedMimeTypes: ATTACHMENT_ALLOWED_MIME_TYPES,
  invalidTypeErrorMessage: '添付は PNG / JPG / WEBP / PDF / TXT / CSV のみ対応しています',
});

function sendAttachmentUploadError(res: Response, err: unknown): void {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: `添付ファイルは${Math.floor(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024))}MB以下にしてください` });
      return;
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      res.status(400).json({ error: `添付は${MAX_ATTACHMENT_FILES}件までです` });
      return;
    }
    res.status(400).json({ error: '添付ファイルのアップロードに失敗しました' });
    return;
  }

  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }

  res.status(400).json({ error: '添付ファイルのアップロードに失敗しました' });
}

export function uploadOptionalAttachments(req: Request, res: Response, next: NextFunction): void {
  attachmentUpload.array('files', MAX_ATTACHMENT_FILES)(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    sendAttachmentUploadError(res, err);
  });
}
