# Public racing catalog browser E2E (Phase 1)

`Browser E2E / catalog-chromium` runs separately from Backend foundation. It uses
Node.js 22, PostgreSQL 17 and `mcr.microsoft.com/playwright:v1.58.2-noble`.
Keep the image version and the exact root `@playwright/test` version together.
Chromium uses Playwright's bundled browser in CI; executable overrides are rejected there.

The job is available through `workflow_dispatch` after merging, runs for relevant PR
paths, and runs on pushes to `feature/qa-browser-e2e` so CI can be checked before
opening this initial PR. It needs no production secrets and has only `contents: read`.
The job container reaches its disposable PostgreSQL service at `postgres:5432`.
Built Fastify and Next.js run in that same container on loopback ports 4000 and 3000.

## Run locally

Use an empty, disposable PostgreSQL 17 database whose name ends in `_test`.
Export `DATABASE_URL` using a local address (`localhost`, `127.0.0.1` or `::1`).
Do not point these commands at a shared database. The runner rejects remote hosts.
No Docker volumes or external infrastructure are required in CI.

```sh
pnpm install --frozen-lockfile
cd services/api
npm ci
npm run db:migrate
npm run db:seed
npm run racing:prepare
npm run racing:import
git diff --exit-code -- seeds reports
npm run build
cd ../..
pnpm build
# Outside the official image, install its matching browser once:
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

The API starts with authentication disabled. The runner sets the server-only
`DERBY_API_URL=http://127.0.0.1:4000` for Next.js. Each readiness probe has a
60-second deadline and individual requests time out after two seconds. Readiness
requires HTTP 200 from `/health/ready`, and HTTP 200 with `pagination.total=851`
from both the API schedule and Next.js catalog bridge. Empty fixture imports and
502/503 responses cannot pass readiness. Unexpected server exits fail the run.
Owned children are terminated on success, failure and interrupt, with a five-second
grace period before SIGKILL. Exit status propagates from Playwright.

For a local environment unable to download Playwright browsers, an already installed
Chromium can be selected with `E2E_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`.
Record this difference when reporting local results: it does not verify the CI image.
Ports 3000 and 4000 must be free. Build both applications before each test run.

## Assertions and evidence

Three tests use real HTTP and browser DOM, without mocking successful API responses:

- 851 source rows, 90 venue options, UI navigation to page 9, and all 51 rendered row
  IDs compared with the actual Fastify response in order.
- UI selection of `RACE_KOR_2026_KOREA_CUP`, matching detail request, title, venue,
  conditions, distance and prize fields; absence of the old Satsuki heading and
  invented weather/weight/entry controls; browser Back/Forward restoration.
- A fresh tab loading the detail URL directly and retaining the same detail after reload.

There is one Chromium worker, no automatic retries, a 45-second test timeout and a
three-minute Playwright global timeout. The workflow itself is bounded to 15 minutes.
The HTML report contains screenshots of page 9/detail and JSON evidence including
browser version, counts and row IDs. Failed tests retain a trace and screenshot.
Browser console warnings/errors, page errors and catalog response paths/statuses
are attached for diagnosis. Raw headers, cookies, storage state, HAR files, environment
dumps and DB connection strings are not collected. Browser contexts are fresh and
anonymous and visit only the local fixture application.

`.e2e-artifacts/` is ignored by Git. Actions uploads this directory even on failure
with a seven-day retention; it contains the report, test results, sanitized API/Next/
Playwright stdout/stderr, and timestamps/exit status in `run.json`.

Phase 2 filters, mobile layouts, error injection and server-career gameplay remain
outside this minimal suite. Existing Node/jsdom/integration tests remain unchanged.
Production UI, game rules, migration checksums, source datasets, seed files, generated
contracts and the existing Backend foundation workflow are unchanged.
