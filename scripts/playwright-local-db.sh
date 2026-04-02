#!/usr/bin/env bash

readonly DEFAULT_LOCAL_POSTGRES_ADMIN_URL="postgres://postgres:postgres@127.0.0.1:5432/postgres"

resolve_local_postgres_admin_url() {
  printf '%s\n' "${LOCAL_POSTGRES_ADMIN_URL:-$DEFAULT_LOCAL_POSTGRES_ADMIN_URL}"
}

assert_local_postgres_admin_url() {
  local admin_url="$1"

  node - "$admin_url" <<'NODE'
const [adminUrl] = process.argv.slice(2);
const parsed = new URL(adminUrl);
const allowedProtocols = new Set(['postgres:', 'postgresql:']);
const allowedHosts = new Set(['127.0.0.1', 'localhost']);

if (!allowedProtocols.has(parsed.protocol) || !allowedHosts.has(parsed.hostname)) {
  console.error(
    `LOCAL_POSTGRES_ADMIN_URL must point to a local Postgres instance. Received: ${adminUrl}`,
  );
  process.exit(1);
}
NODE
}

create_temp_postgres_db() {
  local admin_url="$1"
  local db_name="$2"

  node - "$admin_url" "$db_name" <<'NODE'
const [adminUrl, dbName] = process.argv.slice(2);
const { Client } = require('pg');

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

(async () => {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${quoteIdent(dbName)}`);
  } finally {
    await client.end();
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
NODE
}

drop_temp_postgres_db() {
  local admin_url="$1"
  local db_name="$2"
  [[ -n "$db_name" ]] || return 0

  node - "$admin_url" "$db_name" <<'NODE'
const [adminUrl, dbName] = process.argv.slice(2);
const { Client } = require('pg');

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

(async () => {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [dbName],
    );
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(dbName)}`);
  } finally {
    await client.end();
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
NODE
}

build_temp_postgres_url() {
  local admin_url="$1"
  local db_name="$2"

  node - "$admin_url" "$db_name" <<'NODE'
const [adminUrl, dbName] = process.argv.slice(2);
const nextUrl = new URL(adminUrl);
nextUrl.pathname = `/${dbName}`;
nextUrl.search = '';
nextUrl.hash = '';
console.log(nextUrl.toString());
NODE
}

copy_playwright_traces() {
  local source_dir="$1"
  local target_dir="$2"
  local prefix="${3:-}"
  [[ -d "$source_dir" ]] || return 0

  mkdir -p "$target_dir"

  while IFS= read -r trace_path; do
    local base_name
    base_name="$(basename "$(dirname "$trace_path")")"
    cp "$trace_path" "$target_dir/${prefix}${base_name}-trace.zip"
  done < <(find "$source_dir" -type f -name 'trace.zip' | sort)
}

generate_playwright_summary() {
  local root_dir="$1"
  local summary_file="$2"
  local base_url="$3"
  local api_url="$4"
  shift 4
  local suite_names=("$@")

  mkdir -p "$(dirname "$summary_file")"

  node - "$root_dir" "$summary_file" "$base_url" "$api_url" "${suite_names[@]}" <<'NODE'
const fs = require('fs');
const path = require('path');

const [rootDir, summaryFile, baseUrl, apiUrl, ...requestedSuites] = process.argv.slice(2);
const summaryPath = path.join(rootDir, summaryFile);
const suiteConfigs = [
  {
    name: 'login-dashboard',
    reportJson: 'artifacts/playwright-audit/reports/json/login-dashboard-audit.json',
    reportHtml: 'artifacts/playwright-audit/reports/html/login-dashboard/index.html',
    specs: [
      'dev/e2e/tests/login-smoke.spec.ts',
      'dev/e2e/tests/dashboard-runtime-audit.spec.ts',
    ],
    command: 'npm run test:e2e:local-login-dashboard',
  },
  {
    name: 'proposal-flow',
    reportJson: 'artifacts/playwright-audit/reports/json/proposal-flow-audit.json',
    reportHtml: 'artifacts/playwright-audit/reports/html/proposal-flow/index.html',
    specs: [
      'dev/e2e/tests/proposal-flow.spec.ts',
    ],
    command: 'npm run test:e2e:proposal-flow',
  },
];

const selectedConfigs = requestedSuites.length === 0
  ? suiteConfigs
  : suiteConfigs.filter((config) => requestedSuites.includes(config.name));

const playwrightVersion = require(path.join(rootDir, 'node_modules', 'playwright', 'package.json')).version;

function parseSuite(config) {
  const reportJsonPath = path.join(rootDir, config.reportJson);
  if (!fs.existsSync(reportJsonPath)) {
    return null;
  }

  const report = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8'));
  const stats = report.stats ?? {};
  return {
    name: config.name,
    specs: config.specs,
    reportJson: config.reportJson,
    reportHtml: config.reportHtml,
    expected: stats.expected ?? 0,
    unexpected: stats.unexpected ?? 0,
    flaky: stats.flaky ?? 0,
    skipped: stats.skipped ?? 0,
    durationMs: stats.duration ?? 0,
    startTime: stats.startTime ?? null,
    command: config.command,
  };
}

const suites = selectedConfigs.map(parseSuite).filter(Boolean);
const totals = suites.reduce((acc, suite) => {
  acc.expected += suite.expected;
  acc.unexpected += suite.unexpected;
  acc.flaky += suite.flaky;
  acc.skipped += suite.skipped;
  acc.durationMs += suite.durationMs;
  return acc;
}, {
  expected: 0,
  unexpected: 0,
  flaky: 0,
  skipped: 0,
  durationMs: 0,
});

const executedAt = suites
  .map((suite) => suite.startTime)
  .filter(Boolean)
  .sort()
  .at(-1) ?? new Date().toISOString();

const summary = {
  executedAt,
  playwrightVersion,
  baseUrl,
  apiUrl,
  status: suites.length === 0 ? 'empty' : totals.unexpected === 0 && totals.flaky === 0 ? 'passed' : 'failed',
  suites: suites.map(({ startTime, command, ...suite }) => suite),
  totals,
  executedVia: suites.map((suite) => suite.command),
  appliedFixes: [
    'local-playwright-db-wrapper',
    'proposal-flow-seed-non-admin-account-filter',
    'single-run-playwright-multi-reporter',
  ],
  knownIssues: [
    'db:migrate clean-db smoke is disabled by default because server/drizzle/0019_upload_confirm_jobs.sql and server/drizzle/0021_clean_warpath.sql both create upload_job_status_enum on a fresh database.',
  ],
};

fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
NODE
}
