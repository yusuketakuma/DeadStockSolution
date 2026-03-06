import path from 'path';
import multer from 'multer';

type UploadMiddlewareOptions = {
  maxUploadSize: number;
  allowedExtensions: ReadonlySet<string>;
  allowedMimeTypes: ReadonlySet<string>;
  invalidTypeErrorMessage: string;
};

export function createMemorySingleFileUpload(options: UploadMiddlewareOptions): multer.Multer {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: options.maxUploadSize,
      files: 1,
      fields: 10,
      fieldSize: 100 * 1024,
    },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!options.allowedExtensions.has(ext) || !options.allowedMimeTypes.has(file.mimetype)) {
        cb(new Error(options.invalidTypeErrorMessage));
        return;
      }
      cb(null, true);
    },
  });
}
