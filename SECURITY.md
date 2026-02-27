# Security Policy

## Dependency Vulnerability Policy

- CI blocks pull requests when `npm audit --omit=dev --audit-level=high` detects vulnerabilities in production dependencies.
- Development-only dependency vulnerabilities are triaged separately and tracked until upstream fixes are available.
- Current known dev-only issue class: `drizzle-kit` transitive `esbuild` advisory (`GHSA-67mh-4wv8-2f99`), which does not ship in production runtime.

## Secrets and Environment Variables

- `JWT_SECRET` is required in all non-test environments.
- OpenClaw webhook requests must be authenticated with HMAC signature headers:
  - `x-openclaw-signature`
  - `x-openclaw-timestamp`
- Replayed webhook signatures within the skew window are rejected.
