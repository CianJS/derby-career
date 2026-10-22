# Browser E2E suite

`Browser E2E / catalog-chromium` runs independently of Backend foundation. The full
suite contains 72 Chromium tests using Node.js 22, disposable PostgreSQL 17 and
`mcr.microsoft.com/playwright:v1.58.2-noble`. Keep the image version and exact root
`@playwright/test` dependency together. CI rejects browser executable overrides.

The workflow supports `workflow_dispatch`, relevant PR paths and pushes to
`feature/qa-browser-e2e`. It has only `contents: read` permission and needs no
production secrets. Its container reaches PostgreSQL at `postgres:5432`.

## Run locally

Use an empty, disposable PostgreSQL 17 database whose name ends in `_test`.
Export `DATABASE_URL` using `localhost`, `127.0.0.1` or `::1`; the runner rejects
remote hosts. Do not use a shared database. CI requires no persistent Docker volumes.

```sh
pnpm install --frozen-lockfile
cd services/api
npm ci
npm run db:migrate
npm run db:seed
npm run racing:prepare
npm run racing:import
npm run build
cd ../..
pnpm build
# Outside the official image, install the matching browser once:
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

CI uses `node scripts/prepare-browser-e2e.mjs` for the four fixture commands above.
It checks every seed/report file against its initial SHA-256, including when the
checkout lacks Git metadata, and preserves sanitized setup diagnostics on failure.
The catalog keeps its 851 source rows while the list exposes 848 distinct races,
90 venues and 48 rows on page 9.

Ports 3000, 3001, 4000 and 4001 must be free. Build both applications before running.
Production Next.js on port 3000 reaches the anonymous Fastify catalog on port 4000
through server-only `DERBY_API_URL`. A separate Next development server on port 3001
uses the existing development-session bridge to Fastify on port 4001. The session
credential stays in the server environment. The production server-save bridge remains
blocked; the tests do not change that guard.

Each readiness probe has a 60-second deadline and individual HTTP requests time out
at two seconds. Readiness requires `/health/ready` HTTP 200 and real API/Next catalog
responses with `pagination.total=848`. Empty imports and 502/503 responses cannot pass.
Unexpected server exits fail the run. Owned processes are terminated on success,
failure and interrupt, with five seconds of grace before SIGKILL. Playwright's
nonzero exit status propagates to the job.

For local environments unable to download Playwright browsers, an already installed
Chromium can be selected with `E2E_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`.
Record that difference: a system Chromium run does not validate the official CI image.

The runner forwards Playwright arguments for focused runs and concurrency comparisons:

```sh
pnpm test:e2e --project=chromium-server
pnpm test:e2e --workers=2
```

Project selection restricts tests; the runner still prepares its isolated services.

## Parallel execution and isolation

There are three projects with a global limit of three workers:

| Project            | Tests                                                                      | Project limit               |
| ------------------ | -------------------------------------------------------------------------- | --------------------------- |
| `chromium-catalog` | `catalog-*.spec.ts`, `race-catalog.spec.ts`, all of `recording-ui.spec.ts` | One worker                  |
| `chromium-server`  | Server trust/economy and the two Server overseas cases                     | One worker                  |
| `chromium-local`   | Local economy, trust, completion, layout and overseas cases                | Two workers, fully parallel |

The global cap applies across projects. Catalog tests remain serial because fixtures
restart API 4000 and outage tests deliberately stop it. `recording-ui.spec.ts` also
contains retries against the real catalog, so it belongs in this project. Server
cases remain serial because they retain one owner and its saved database history.
Local tests use separate browser contexts, isolating localStorage, Web Locks and
BroadcastChannel; deliberate two-tab scenarios keep both tabs in their own context.
Every existing test is assigned exactly once, including both halves of the mixed
Local/Server overseas file. No viewport, theme, assertion or scenario matrix is removed.
New spec files must be classified in `playwright.config.ts`; unclassified files fail
configuration loading instead of silently losing coverage.

The runner uses independent file mailboxes for catalog and save API control:
`E2E_API_CONTROL_DIR` and `E2E_SERVER_CONTROL_DIR`. Concurrent projects cannot overwrite
one another's request/response files. These are local runner controls, not application
HTTP endpoints.

Five fixed 61-second quota sleeps are replaced with bounded restarts/readiness checks
of the disposable save API at completed-command checkpoints and scenario boundaries.
PostgreSQL, saved careers, session credentials and Next.js stay intact. Only that
process's in-memory request bucket resets; the production `120 requests/minute` limit
is unchanged. The same real HTTP requests and persistence/retry assertions still run.
Each runner invocation creates its own test owner, so repeated runs against the same
ephemeral database cannot reuse a previous run's funds, active horse or retirements.
Catalog fixtures use the same fresh-process isolation and combine stop/start into a
single restart request. Successful API responses are never mocked to make tests pass.

## Coverage, limits and evidence

The suite covers catalog counts, filters, currencies, direct URLs, history/scroll
restoration, actual outages and honest errors; mobile/desktop save management and
race layouts; local trust/economy settlement, reload, retirement and independent new
horses; and real server trust/economy and Japan/US expedition flows. Server cases
include lost receipts, identical-request retries, foreign/domestic races and persistent
records. Shared game calculations, raw source fixtures, migrations and API contracts
are unchanged.

Tests have no automatic retries. The default test timeout is 45 seconds, with explicit
longer bounds on server scenarios; expect assertions have a ten-second timeout. The
Playwright global limit remains 15 minutes and the CI job limit remains 20 minutes
while optimized runtime is measured. These are failure bounds, not intentional waits.

The HTML report includes screenshots and browser/network evidence. Failures retain
screenshots and traces. `.e2e-artifacts/results.json` records test-level durations and
outcomes. `run.json` records timestamps, exit status, Node version, total duration and
startup/test/cleanup timings in milliseconds, so test time is distinguishable from
service startup and CI setup.

`.e2e-artifacts/` is Git-ignored and uploaded even on failure, with seven-day retention.
It includes the reports and sanitized API/Next/Playwright stdout/stderr. Custom
diagnostics record catalog paths/statuses, page errors and console warnings/errors;
they do not dump raw headers, cookies, storage state, HAR or the process environment.
Database URLs and development-session credentials are redacted from process logs.
Playwright traces are limited to fresh browser contexts visiting the local fixture
application; server credentials are never passed into browser requests or reports.

## Runtime baseline

The successful [baseline run 39588622955](https://github.com/CianJS/derby-career/actions/runs/39588622955)
uses the same code tree as the starting `develop` commit `f3d23aa`:

| Measurement                    | Baseline                |
| ------------------------------ | ----------------------- |
| Whole `catalog-chromium` job   | 687 seconds (11m 27s)   |
| Real HTTP E2E step             | 576 seconds (9m 36s)    |
| Five fixed quota sleeps        | 305 seconds (5m 5s)     |
| Container startup / Next build | 54 seconds / 13 seconds |

The fixed sleeps account for about 53% of the E2E step. Optimized full-suite timings
are pending measurement; compare successful runs with all 72 tests and the same
Chromium image. Do not equate a focused project, skipped tests or a local system
Chromium run with full CI validation.
