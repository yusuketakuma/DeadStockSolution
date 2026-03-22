#!/usr/bin/env node

const baseUrl = (process.env.SMOKE_BASE_URL ?? process.env.PREVIEW_SMOKE_BASE_URL ?? '').trim().replace(/\/+$/, '');

if (!baseUrl) {
  console.error('[smoke] Set SMOKE_BASE_URL or PREVIEW_SMOKE_BASE_URL');
  process.exit(1);
}

const checks = [
  {
    name: 'health',
    url: `${baseUrl}/api/health`,
    assert: async (response) => {
      if (!response.ok) {
        throw new Error(`expected 2xx, got ${response.status}`);
      }
      const body = await response.json().catch(() => ({}));
      if (body?.status !== 'ok' && body?.status !== 'degraded') {
        throw new Error(`unexpected health status: ${JSON.stringify(body)}`);
      }
    },
  },
  {
    name: 'csrf-token',
    url: `${baseUrl}/api/auth/csrf-token`,
    assert: async (response) => {
      if (!response.ok) {
        throw new Error(`expected 2xx, got ${response.status}`);
      }
      const body = await response.json().catch(() => ({}));
      if (typeof body?.csrfToken !== 'string' || body.csrfToken.length === 0) {
        throw new Error(`csrfToken missing: ${JSON.stringify(body)}`);
      }
    },
  },
];

for (const check of checks) {
  const response = await fetch(check.url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'dead-stock-solution-smoke-check',
    },
  });
  await check.assert(response);
  console.log(`[smoke] OK ${check.name}: ${check.url}`);
}
