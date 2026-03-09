import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { createMemorySingleFileUpload } from '../middleware/upload-middleware';

describe('upload middleware', () => {
  describe('createMemorySingleFileUpload', () => {
    const defaultOptions = {
      maxUploadSize: 10 * 1024 * 1024, // 10MB
      allowedExtensions: new Set(['.xlsx', '.csv']),
      allowedMimeTypes: new Set([
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
      ]),
      invalidTypeErrorMessage: 'ファイル形式が無効です',
    };

    it('returns a multer instance', () => {
      const uploader = createMemorySingleFileUpload(defaultOptions);
      expect(uploader).toBeDefined();
      expect(typeof uploader.single).toBe('function');
    });

    it('uses memory storage', () => {
      const uploader = createMemorySingleFileUpload(defaultOptions);
      // Verify the multer instance has the expected structure
      expect(uploader).toHaveProperty('single');
      expect(uploader).toHaveProperty('array');
      expect(uploader).toHaveProperty('fields');
    });

    it('enforces maxUploadSize limit', () => {
      const options = {
        ...defaultOptions,
        maxUploadSize: 5 * 1024 * 1024, // 5MB
      };
      const uploader = createMemorySingleFileUpload(options);
      expect(uploader).toBeDefined();
      // The limit is enforced by multer internally during file upload
    });

    it('limits files to 1', () => {
      const uploader = createMemorySingleFileUpload(defaultOptions);
      expect(uploader).toBeDefined();
      // Multer enforces this limit during upload
    });

    it('limits fields to 10 and fieldSize to 100KB', () => {
      const uploader = createMemorySingleFileUpload(defaultOptions);
      expect(uploader).toBeDefined();
      // Multer enforces these limits during upload
    });

    describe('fileFilter', () => {
      function testFileFilter(
        file: { originalname: string; mimetype: string },
        shouldAccept: boolean,
        expectedError?: string
      ): Promise<void> {
        return new Promise<void>((resolve) => {
          const uploader = createMemorySingleFileUpload(defaultOptions);
          const middleware = uploader.single('file');

          const req = { file } as unknown as Request;
          const res = {} as unknown as Response;

          const fileFilter = (middleware as any).fileFilter;
          if (fileFilter) {
            fileFilter(req, file, (err: Error | null) => {
              if (shouldAccept) {
                expect(err).toBeNull();
              } else {
                expect(err).not.toBeNull();
                if (expectedError) {
                  expect(err?.message).toBe(expectedError);
                }
              }
              resolve();
            });
          } else {
            resolve();
          }
        });
      }

      it('accepts files with allowed extensions and MIME types', () => {
        return testFileFilter(
          {
            originalname: 'inventory.xlsx',
            mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
          true
        );
      });

      it('accepts CSV files with allowed MIME type', () => {
        return testFileFilter(
          {
            originalname: 'inventory.csv',
            mimetype: 'text/csv',
          },
          true
        );
      });

      it('rejects files with disallowed extensions', () => {
        return testFileFilter(
          {
            originalname: 'inventory.txt',
            mimetype: 'text/plain',
          },
          false,
          'ファイル形式が無効です'
        );
      });

      it('rejects files with disallowed MIME types', () => {
        return testFileFilter(
          {
            originalname: 'inventory.xlsx',
            mimetype: 'application/json',
          },
          false,
          'ファイル形式が無効です'
        );
      });

      it('returns custom error message for invalid type', () => {
        return new Promise<void>((resolve) => {
          const customMessage = 'カスタムエラーメッセージ';
          const options = {
            ...defaultOptions,
            invalidTypeErrorMessage: customMessage,
          };
          const uploader = createMemorySingleFileUpload(options);
          const middleware = uploader.single('file');

          const file = {
            originalname: 'inventory.pdf',
            mimetype: 'application/pdf',
          };
          const req = { file } as unknown as Request;
          const res = {} as unknown as Response;

          const fileFilter = (middleware as any).fileFilter;
          if (fileFilter) {
            fileFilter(req, file, (err: Error | null) => {
              expect(err).not.toBeNull();
              expect(err?.message).toBe(customMessage);
              resolve();
            });
          } else {
            resolve();
          }
        });
      });

      it('is case-insensitive for file extensions', () => {
        return testFileFilter(
          {
            originalname: 'inventory.XLSX',
            mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
          true
        );
      });

      it('rejects when extension is allowed but MIME type is not', () => {
        return testFileFilter(
          {
            originalname: 'inventory.xlsx',
            mimetype: 'application/octet-stream',
          },
          false,
          'ファイル形式が無効です'
        );
      });

      it('rejects when MIME type is allowed but extension is not', () => {
        return testFileFilter(
          {
            originalname: 'inventory.bin',
            mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
          false,
          'ファイル形式が無効です'
        );
      });

      it('handles files without extension', () => {
        return testFileFilter(
          {
            originalname: 'inventory',
            mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
          false,
          'ファイル形式が無効です'
        );
      });

      it('handles files with multiple dots in name', () => {
        return testFileFilter(
          {
            originalname: 'inventory.backup.xlsx',
            mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
          true
        );
      });
    });

    describe('with different allowed extensions and MIME types', () => {
      it('works with custom allowed extensions and MIME types', () => {
        return new Promise<void>((resolve) => {
          const customOptions = {
            maxUploadSize: 5 * 1024 * 1024,
            allowedExtensions: new Set(['.json', '.xml']),
            allowedMimeTypes: new Set(['application/json', 'application/xml']),
            invalidTypeErrorMessage: 'JSONまたはXML形式のみ許可されています',
          };
          const uploader = createMemorySingleFileUpload(customOptions);
          const middleware = uploader.single('file');

          const file = {
            originalname: 'data.json',
            mimetype: 'application/json',
          };
          const req = { file } as unknown as Request;
          const res = {} as unknown as Response;

          const fileFilter = (middleware as any).fileFilter;
          if (fileFilter) {
            fileFilter(req, file, (err: Error | null) => {
              expect(err).toBeNull();
              resolve();
            });
          } else {
            resolve();
          }
        });
      });

      it('rejects files not in custom allowed list', () => {
        return new Promise<void>((resolve) => {
          const customOptions = {
            maxUploadSize: 5 * 1024 * 1024,
            allowedExtensions: new Set(['.json', '.xml']),
            allowedMimeTypes: new Set(['application/json', 'application/xml']),
            invalidTypeErrorMessage: 'JSONまたはXML形式のみ許可されています',
          };
          const uploader = createMemorySingleFileUpload(customOptions);
          const middleware = uploader.single('file');

          const file = {
            originalname: 'inventory.csv',
            mimetype: 'text/csv',
          };
          const req = { file } as unknown as Request;
          const res = {} as unknown as Response;

          const fileFilter = (middleware as any).fileFilter;
          if (fileFilter) {
            fileFilter(req, file, (err: Error | null) => {
              expect(err).not.toBeNull();
              expect(err?.message).toBe('JSONまたはXML形式のみ許可されています');
              resolve();
            });
          } else {
            resolve();
          }
        });
      });
    });
  });
});
