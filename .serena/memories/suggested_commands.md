# Suggested commands (Darwin/macOS)

## Setup
```bash
npm install
```

## Development
```bash
npm run dev:server
npm run dev:client
```

## Build / runtime
```bash
npm run build:server
npm run build:client
npm run start --workspace=server
npm run preview --workspace=client
```

## Quality gates
```bash
npm run typecheck
npm run lint
npm run test
npm run test:coverage
npm run quality:gate
```

## Workspace-specific tests
```bash
npm run test:server
npm run test:integration:server
npm run test:perf:server
npm run test:perf:update:server
npm run test:client
npm run test:e2e
```

## API spec
```bash
npm run openapi:generate
npm run openapi:check
```

## DB tasks (server)
```bash
npm run db:migrate --workspace=server
npm run db:migrate:legacy --workspace=server
npm run db:seed-admin --workspace=server
npm run db:seed-test-pharmacies --workspace=server
```

## Deploy helpers
```bash
npm run deploy:preview
npm run deploy:prod
```

## Useful macOS terminal commands
```bash
pwd
ls -la
cd <path>
rg "<pattern>" .
rg --files
find . -name "<name>"
git status
git diff
git log --oneline -n 20
```