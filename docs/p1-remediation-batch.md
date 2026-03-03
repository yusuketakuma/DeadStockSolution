# docs/p1-remediation-batch.md

## Objective
Fix 12 review findings using:
Implementation (batch) -> Verification (batch) -> Broad Review (parallel, read-only) -> Fix -> Re-verify.

## Phase A: Plan (parallel)
1) explorer: map exact locations + related areas + numeric estimates
2) docs_researcher: collect minimal primary-source guidance for CSV/SQL/authz
3) security_auditor: preflight “common wrong fixes” for #2/#3/#4/#7

## Phase B: Implementation (NO REVIEW)
Assignments (fixed):
- implementer_light: #1 #9 #10 #11
- implementer_heavy: #2 #3 #4 #5 #6 #7 #12
- ci_fixer: #8 + api-inventory drift if pnpm lint fails
- test_writer: add regression tests (authz/sql/secrets/csv/sdk)

Rules:
- Each implementer touches only assigned files.
- No /review, no broad scanning, no repo-wide refactors.
- Implementation includes tests; do not defer tests into “review”.

## Phase C: Verification (run once at end)
verifier runs (in order):
1) pnpm typecheck
2) pnpm --filter @careroute-rx/web lint
3) pnpm lint
4) relevant tests/build (repo-specific)

If fails:
- Route to responsible implementer/ci_fixer -> fix -> re-run verifier.

## Phase D: Broad review (read-only, parallel)
- quality_reviewer
- test_auditor
- security_auditor
- perf_sleuth
- reviewer aggregates and prioritizes

## Phase E: Fix & Re-verify (bounded)
- Fix P0/P1 issues only, then re-run verifier.
- Stop when: verification PASS + P0/P1=0.
- Do NOT start repo-wide “improvement loops”.
