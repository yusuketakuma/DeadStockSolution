import { afterEach, describe, expect, it } from 'vitest';
import {
  getOpenClawImplementationBranch,
  handoffToOpenClaw,
  isImplementationBranchAllowed,
  isOpenClawConnectorConfigured,
} from '../services/openclaw-service';

const OPENCLAW_ENV_KEYS = [
  'OPENCLAW_BASE_URL',
  'OPENCLAW_API_KEY',
  'OPENCLAW_AGENT_ID',
  'OPENCLAW_IMPLEMENT_BRANCH',
  'OPENCLAW_TIMEOUT_MS',
] as const;

const originalEnv: Partial<Record<(typeof OPENCLAW_ENV_KEYS)[number], string | undefined>> = {};
for (const key of OPENCLAW_ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

function resetOpenClawEnv(): void {
  for (const key of OPENCLAW_ENV_KEYS) {
    const value = originalEnv[key];
    if (typeof value === 'string') {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

function setConnectorEnv(baseUrl: string): void {
  process.env.OPENCLAW_BASE_URL = baseUrl;
  process.env.OPENCLAW_API_KEY = 'dummy-api-key';
  process.env.OPENCLAW_AGENT_ID = 'dummy-agent-id';
}

describe('openclaw-service', () => {
  afterEach(() => {
    resetOpenClawEnv();
  });

  it('always uses review as implementation branch', () => {
    process.env.OPENCLAW_IMPLEMENT_BRANCH = 'main';

    expect(getOpenClawImplementationBranch()).toBe('review');
    expect(isImplementationBranchAllowed('review')).toBe(true);
    expect(isImplementationBranchAllowed('main')).toBe(false);
  });

  it('accepts HTTPS connector base URL', () => {
    setConnectorEnv('https://openclaw.example.com/');
    expect(isOpenClawConnectorConfigured()).toBe(true);
  });

  it('accepts HTTP only for localhost', () => {
    setConnectorEnv('http://localhost:9000');
    expect(isOpenClawConnectorConfigured()).toBe(true);
  });

  it('rejects non-localhost HTTP base URL', () => {
    setConnectorEnv('http://openclaw.example.com');
    expect(isOpenClawConnectorConfigured()).toBe(false);
  });

  it('rejects invalid base URL', () => {
    setConnectorEnv('not-a-valid-url');
    expect(isOpenClawConnectorConfigured()).toBe(false);
  });

  it('returns secure setup guidance when insecure URL is configured', async () => {
    setConnectorEnv('http://openclaw.example.com');

    const result = await handoffToOpenClaw({
      requestId: 1,
      pharmacyId: 1,
      requestText: 'テスト要望',
    });

    expect(result.accepted).toBe(false);
    expect(result.connectorConfigured).toBe(false);
    expect(result.note).toContain('HTTPS');
  });
});
