#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const protectionBypass = (
  process.env.SMOKE_PROTECTION_BYPASS
  ?? process.env.PREVIEW_PROTECTION_BYPASS
  ?? process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  ?? ''
).trim();
const vercelToken = (process.env.VERCEL_TOKEN ?? '').trim();
const vercelProjectName = (process.env.SMOKE_VERCEL_PROJECT_NAME ?? '').trim();
const vercelEnvironment = (process.env.SMOKE_VERCEL_ENVIRONMENT ?? 'preview').trim();
const vercelGithubSha = (
  process.env.SMOKE_VERCEL_GITHUB_SHA
  ?? process.env.GITHUB_SHA
  ?? ''
).trim();
const vercelGithubRef = (
  process.env.SMOKE_VERCEL_GITHUB_REF
  ?? process.env.GITHUB_REF_NAME
  ?? process.env.VERCEL_GIT_COMMIT_REF
  ?? ''
).trim();
const smokeResolveTimeoutMs = Number.parseInt(process.env.SMOKE_RESOLVE_TIMEOUT_MS ?? '300000', 10);
const smokeResolveIntervalMs = Number.parseInt(process.env.SMOKE_RESOLVE_INTERVAL_MS ?? '10000', 10);
const baseUrlInput = (process.env.SMOKE_BASE_URL ?? process.env.PREVIEW_SMOKE_BASE_URL ?? '').trim().replace(/\/+$/, '');

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const readLinkedProjectName = async () => {
  if (vercelProjectName) {
    return vercelProjectName;
  }

  try {
    const projectJsonPath = resolvePath(process.cwd(), '.vercel/project.json');
    const contents = await readFile(projectJsonPath, 'utf8');
    const parsed = JSON.parse(contents);
    return typeof parsed?.projectName === 'string' ? parsed.projectName.trim() : '';
  } catch {
    return '';
  }
};

const buildVercelArgs = (projectName, metaFilter) => {
  const args = [
    'list',
    projectName,
    '--environment',
    vercelEnvironment,
    '--status',
    'READY',
    '--format',
    'json',
  ];

  if (metaFilter) {
    args.push('--meta', metaFilter);
  }

  if (vercelToken) {
    args.push('--token', vercelToken);
  }

  return args;
};

const listVercelDeployments = async (projectName, metaFilter) => {
  const { stdout } = await execFile(
    'vercel',
    buildVercelArgs(projectName, metaFilter),
    { maxBuffer: 10 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed?.deployments) ? parsed.deployments : [];
};

const resolveBaseUrl = async () => {
  if (baseUrlInput) {
    return baseUrlInput;
  }

  const projectName = await readLinkedProjectName();
  if (!projectName) {
    console.error('[smoke] Set SMOKE_BASE_URL/PREVIEW_SMOKE_BASE_URL or provide .vercel/project.json / SMOKE_VERCEL_PROJECT_NAME');
    process.exit(1);
  }

  if (vercelGithubSha) {
    const deadline = Date.now() + Math.max(smokeResolveTimeoutMs, 0);

    while (Date.now() <= deadline) {
      const deployments = await listVercelDeployments(projectName, `githubCommitSha=${vercelGithubSha}`);
      const deployment = deployments.find((item) => typeof item?.url === 'string' && item.url.length > 0);

      if (deployment?.url) {
        const resolvedUrl = `https://${deployment.url}`;
        console.log(`[smoke] resolved exact deployment for ${vercelGithubSha.slice(0, 7)}: ${resolvedUrl}`);
        return resolvedUrl;
      }

      if (Date.now() + smokeResolveIntervalMs > deadline) {
        break;
      }

      console.log(`[smoke] waiting for READY preview deployment for commit ${vercelGithubSha.slice(0, 7)}...`);
      await sleep(smokeResolveIntervalMs);
    }
  }

  if (vercelGithubRef) {
    const deployments = await listVercelDeployments(projectName, `githubCommitRef=${vercelGithubRef}`);
    const branchAlias = deployments.find((item) => typeof item?.meta?.branchAlias === 'string' && item.meta.branchAlias.length > 0)?.meta?.branchAlias;
    if (branchAlias) {
      const resolvedUrl = `https://${branchAlias}`;
      console.log(`[smoke] resolved branch alias for ${vercelGithubRef}: ${resolvedUrl}`);
      return resolvedUrl;
    }

    const deploymentUrl = deployments.find((item) => typeof item?.url === 'string' && item.url.length > 0)?.url;
    if (deploymentUrl) {
      const resolvedUrl = `https://${deploymentUrl}`;
      console.log(`[smoke] resolved latest branch deployment for ${vercelGithubRef}: ${resolvedUrl}`);
      return resolvedUrl;
    }
  }

  console.error('[smoke] Could not resolve preview deployment URL. Set SMOKE_BASE_URL/PREVIEW_SMOKE_BASE_URL or provide VERCEL_TOKEN with GITHUB_SHA/GITHUB_REF_NAME.');
  process.exit(1);
};

const baseUrl = await resolveBaseUrl();
const base = new URL(baseUrl);
const buildCheckUrl = (pathname) => {
  const url = new URL(base.toString());
  url.pathname = pathname;
  return url.toString();
};
const deploymentTarget = `${base.protocol}//${base.host}`;

const fetchViaVercelCurl = async (pathname) => {
  const { stdout } = await execFile(
    'vercel',
    [
      'curl',
      pathname,
      '--deployment',
      deploymentTarget,
      '--',
      '--silent',
      '--show-error',
      '--write-out',
      '\n__STATUS__:%{http_code}',
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );

  const statusMarker = '\n__STATUS__:';
  const markerIndex = stdout.lastIndexOf(statusMarker);
  if (markerIndex === -1) {
    throw new Error('vercel curl did not return a status marker');
  }

  const body = stdout.slice(0, markerIndex);
  const status = Number.parseInt(stdout.slice(markerIndex + statusMarker.length).trim(), 10);
  return new Response(body, {
    status: Number.isNaN(status) ? 500 : status,
    headers: { 'content-type': 'application/json' },
  });
};

const fetchSmokeResponse = async (pathname, url) => {
  const directResponse = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'dead-stock-solution-smoke-check',
      ...(protectionBypass ? { 'x-vercel-protection-bypass': protectionBypass } : {}),
    },
  });

  if (directResponse.status !== 401 || protectionBypass) {
    return directResponse;
  }

  try {
    return await fetchViaVercelCurl(pathname);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[smoke] vercel curl fallback failed for ${pathname}: ${reason}`);
    return directResponse;
  }
};

const checks = [
  {
    name: 'health',
    pathname: '/api/health',
    url: buildCheckUrl('/api/health'),
    assert: async (response) => {
      if (!response.ok) {
        if (response.status === 401 && !protectionBypass) {
          throw new Error('expected 2xx, got 401 (set SMOKE_PROTECTION_BYPASS or PREVIEW_PROTECTION_BYPASS for protected previews)');
        }
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
    pathname: '/api/auth/csrf-token',
    url: buildCheckUrl('/api/auth/csrf-token'),
    assert: async (response) => {
      if (!response.ok) {
        if (response.status === 401 && !protectionBypass) {
          throw new Error('expected 2xx, got 401 (set SMOKE_PROTECTION_BYPASS or PREVIEW_PROTECTION_BYPASS for protected previews)');
        }
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
  const response = await fetchSmokeResponse(check.pathname, check.url);
  await check.assert(response);
  console.log(`[smoke] OK ${check.name}: ${check.url}`);
}
