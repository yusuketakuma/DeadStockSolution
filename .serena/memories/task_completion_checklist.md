# Task completion checklist for this project

Use this sequence when finishing implementation work:

1. Typecheck
```bash
npm run typecheck
```

2. Lint
```bash
npm run lint
```

3. Tests
```bash
npm run test
```

Additional targeted checks when relevant:
- Server integration/perf: `npm run test:integration:server`, `npm run test:perf:server`
- Coverage: `npm run test:coverage`
- OpenAPI drift: `npm run openapi:check`
- Full repo gate script: `npm run quality:gate`

Operational notes:
- If DB or schema changes were made, run relevant migration/seed commands in `server` workspace.
- For deployment paths, branch guards exist in deploy scripts (`preview` for preview deploy, `main` for prod deploy).