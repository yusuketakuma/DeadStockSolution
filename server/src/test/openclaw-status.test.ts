import { afterEach, describe, expect, it } from 'vitest';
import { getOpenClawConfig, isOpenClawConnectorConfigured, isOpenClawWebhookConfigured } from '../services/openclaw-status';

const OPENCLAW_ENV_KEYS = [
  'OPENCLAW_CONNECTOR_MODE',
  'OPENCLAW_CLI_PATH',
  'OPENCLAW_BASE_URL',
  'OPENCLAW_API_KEY',
  'OPENCLAW_AGENT_ID',
  'OPENCLAW_WEBHOOK_SECRET',
] as const;

const originalEnv: Partial<Record<(typeof OPENCLAW_ENV_KEYS)[number], string | undefined>> = {};
for (const key of OPENCLAW_ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

function resetEnv(): void {
  for (const key of OPENCLAW_ENV_KEYS) {
    const value = originalEnv[key];
    if (typeof value === 'string') {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

describe('openclaw-status', () => {
  afterEach(() => {
    resetEnv();
  });

  it('treats managed_remote_agent as configured without legacy credentials', () => {
    process.env.OPENCLAW_CONNECTOR_MODE = 'managed_remote_agent';
    delete process.env.OPENCLAW_BASE_URL;
    delete process.env.OPENCLAW_API_KEY;
    delete process.env.OPENCLAW_AGENT_ID;

    expect(getOpenClawConfig().mode).toBe('managed_remote_agent');
    expect(isOpenClawConnectorConfigured()).toBe(true);
  });

  it('still requires webhook secret separately in managed_remote_agent mode', () => {
    process.env.OPENCLAW_CONNECTOR_MODE = 'managed_remote_agent';
    delete process.env.OPENCLAW_WEBHOOK_SECRET;

    expect(isOpenClawConnectorConfigured()).toBe(true);
    expect(isOpenClawWebhookConfigured()).toBe(false);
  });
});
