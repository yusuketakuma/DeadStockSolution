import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../middleware/error-handler';

function createApp() {
  const app = express();
  app.use(express.json());

  app.post('/json', (_req, res) => {
    res.status(204).end();
  });

  app.get('/http-error', (_req, _res, next) => {
    const err = new Error('not found') as Error & { status: number };
    err.status = 404;
    next(err);
  });

  app.get('/boom', () => {
    throw new Error('boom');
  });

  app.get('/unsafe-code', (_req, _res, next) => {
    const err = new Error('db detail') as Error & { status: number; code: string };
    err.status = 400;
    err.code = '42703';
    next(err);
  });

  app.get('/safe-code', (_req, _res, next) => {
    const err = new Error('queue full') as Error & { status: number; code: string };
    err.status = 429;
    err.code = 'UPLOAD_CONFIRM_QUEUE_LIMIT';
    next(err);
  });

  app.use(errorHandler);
  return app;
}

describe('error-handler', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
      return;
    }
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns 400 for malformed JSON body', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/json')
      .set('content-type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'リクエスト本文の形式が不正です', code: 'BAD_JSON_PAYLOAD' });
  });

  it('preserves explicit HTTP status errors', async () => {
    const app = createApp();
    const res = await request(app).get('/http-error');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'リクエストに失敗しました', code: 'HTTP_404' });
  });

  it('hides 4xx details in production', async () => {
    process.env.NODE_ENV = 'production';
    const app = createApp();
    const res = await request(app).get('/http-error');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'リクエストに失敗しました', code: 'HTTP_404' });
  });

  it('hides 500 details in production', async () => {
    process.env.NODE_ENV = 'production';
    const app = createApp();
    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'サーバーエラーが発生しました', code: 'INTERNAL_SERVER_ERROR' });
  });

  it('does not expose non-whitelisted internal error codes', async () => {
    const app = createApp();
    const res = await request(app).get('/unsafe-code');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'リクエストに失敗しました', code: 'HTTP_400' });
  });

  it('keeps whitelisted application error codes', async () => {
    const app = createApp();
    const res = await request(app).get('/safe-code');

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'リクエストに失敗しました', code: 'UPLOAD_CONFIRM_QUEUE_LIMIT' });
  });
});
