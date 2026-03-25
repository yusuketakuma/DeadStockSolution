import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setupSecurity } from '../config/app-security';

function createSecurityApp() {
  const app = express();
  app.disable('x-powered-by');
  setupSecurity(app);
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('セキュリティヘッダー', () => {
  it('Permissions-Policy ヘッダーが設定されており camera, microphone, geolocation, payment を含む', async () => {
    const res = await request(createSecurityApp()).get('/api/health');

    const policy = res.headers['permissions-policy'] as string;
    expect(policy).toBeDefined();
    expect(policy).toContain('camera=(self)');
    expect(policy).toContain('microphone=()');
    expect(policy).toContain('geolocation=()');
    expect(policy).toContain('payment=()');
  });

  it('Referrer-Policy ヘッダーが strict-origin-when-cross-origin である', async () => {
    const res = await request(createSecurityApp()).get('/api/health');

    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('X-Content-Type-Options ヘッダーが nosniff である', async () => {
    const res = await request(createSecurityApp()).get('/api/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('X-Frame-Options ヘッダーが存在する', async () => {
    const res = await request(createSecurityApp()).get('/api/health');

    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('X-Powered-By ヘッダーが存在しない', async () => {
    const res = await request(createSecurityApp()).get('/api/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
