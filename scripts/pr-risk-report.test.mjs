import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  buildReport,
  classifyPath,
  parseDeclaredRisk,
  readPullRequest,
  renderSummary,
} from './pr-risk-report.mjs'

const script = fileURLToPath(new URL('./pr-risk-report.mjs', import.meta.url))
const root = new URL('../', import.meta.url)
const governance = 'PR governance: risk-report'
const backend = 'Backend foundation: verify, verify-vercel, verify-frontend'
const browser = 'Browser E2E: catalog-chromium'
const bothProducts = [governance, backend, browser]
const requestEntrypoints = [
  'middleware.ts',
  'middleware.js',
  'proxy.ts',
  'proxy.js',
  'src/middleware.ts',
  'src/middleware.js',
  'src/proxy.ts',
  'src/proxy.js',
]

test('실존 의존성·빌드·검증 설정은 HIGH이고 관련 기존 CI를 권장', () => {
  const cases = [
    ['package.json', bothProducts],
    ['pnpm-lock.yaml', bothProducts],
    ['pnpm-workspace.yaml', bothProducts],
    ['services/api/package.json', bothProducts],
    ['services/api/package-lock.json', bothProducts],
    ['packages/shared/package.json', bothProducts],
    ['next.config.mjs', bothProducts],
    ['postcss.config.mjs', bothProducts],
    ['playwright.config.ts', bothProducts],
    ['tsconfig.json', bothProducts],
    ['services/api/tsconfig.json', bothProducts],
    ['services/api/eslint.config.mjs', bothProducts],
    ['tsconfig.frontend-integration.json', [governance, backend]],
    ['.editorconfig', [governance, backend]],
    ['.prettierrc.json', [governance, backend]],
    ['.prettierignore', [governance, backend]],
  ]
  for (const [path, checks] of cases) {
    assert.ok(existsSync(new URL(path, root)), `실존 설정 경로를 갱신해야 함: ${path}`)
    const report = buildReport({ paths: [path], body: 'Risk-Level: LOW' })
    assert.equal(report.minimum, 'HIGH', path)
    assert.deepEqual(report.checks, checks, path)
    assert.equal(report.warnings.length, 1, `${path}: LOW 과소 선언 경고 누락`)
  }
})

test('기존 검사 실행·준비·계약 검증 스크립트도 HIGH로 분류', () => {
  for (const path of [
    'scripts/run-browser-e2e.mjs',
    'scripts/prepare-browser-e2e.mjs',
    'services/api/scripts/format.mjs',
    'services/api/scripts/lint.mjs',
    'services/api/scripts/check-contract.ts',
    'services/api/scripts/api-types.ts',
    'services/api/scripts/event-validation.ts',
    'services/api/scripts/save-validation.ts',
    'services/api/scripts/convert-events.ts',
    'services/api/scripts/expand-events.ts',
    'services/api/scripts/prepare-racing.ts',
    'services/api/scripts/http-smoke.mjs',
    'services/api/scripts/catalog-smoke.mjs',
    'services/api/scripts/preflight-events.ts',
  ]) {
    assert.ok(existsSync(new URL(path, root)), `실존 스크립트 경로를 갱신해야 함: ${path}`)
    const report = buildReport({ paths: [path], body: 'Risk-Level: HIGH' })
    assert.equal(report.minimum, 'HIGH', path)
    assert.deepEqual(report.checks, bothProducts, path)
  }
})

test('신규 Next 요청 진입점은 파일 생성 전에도 HIGH 및 Frontend/HTTP 검사 권장', () => {
  for (const path of requestEntrypoints) {
    // Prospective paths: do not require these files to exist or add fake runtime files.
    const report = buildReport({ paths: [path], body: 'Risk-Level: LOW' })
    assert.equal(report.minimum, 'HIGH', path)
    assert.ok(report.areas.includes('Frontend'), path)
    assert.deepEqual(report.checks, bothProducts, path)
    assert.equal(report.warnings.length, 1, path)
  }
})

test('일반 코드의 config/package/스크립트 이름만으로 HIGH를 확대하지 않음', () => {
  for (const path of [
    'components/config.ts',
    'lib/notices/config.ts',
    'docs/next.config.mjs',
    'services/worker/package.json',
    'scripts/run-demo.mjs',
    'scripts/prepare-report.mjs',
    'tests/e2e/example.spec.ts',
    'components.json',
  ]) {
    assert.equal(classifyPath(path).level, 'MEDIUM', path)
  }
})

function workflowPaths(name) {
  const source = readFileSync(new URL(`.github/workflows/${name}.yml`, root), 'utf8')
  // Guard the actual literal paths list, without adding YAML/glob dependencies to CI.
  // A syntax change must update this narrow test reader rather than silently skip coverage.
  const marker = '\n  pull_request:\n    paths:\n'
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `${name}: pull_request.paths 구문을 확인해야 함`)
  const patterns = []
  for (const line of source.slice(start + marker.length).split('\n')) {
    if (!line.trim() || line.startsWith('      #')) {
      continue
    }
    if (!line.startsWith('      ')) {
      break
    }
    const entry = /^      - '([^']+)'$/.exec(line)
    assert.ok(entry, `${name}: 지원하지 않는 paths 구문: ${line}`)
    patterns.push(entry[1])
  }
  assert.ok(patterns.length > 0, name)
  return patterns
}

function pathMatches(patterns, path) {
  let included = false
  for (const entry of patterns) {
    const exclude = entry.startsWith('!')
    const pattern = exclude ? entry.slice(1) : entry
    let matches
    if (pattern === '**/*.md') {
      matches = path.endsWith('.md')
    } else if (pattern.endsWith('/**')) {
      matches = path.startsWith(pattern.slice(0, -2))
    } else {
      assert.ok(!/[*?{}\[\]]/.test(pattern), `새 glob은 검증 방식을 갱신해야 함: ${pattern}`)
      matches = path === pattern
    }
    if (matches) {
      included = !exclude
    }
  }
  return included
}

test('전체 추적 파일·예정 진입점의 권장 제품 검사가 실제 workflow paths와 일치', () => {
  const workflows = [
    [backend, workflowPaths('backend-foundation')],
    [browser, workflowPaths('browser-e2e')],
  ]
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
  for (const path of [...tracked, ...requestEntrypoints]) {
    const expected = [governance]
    for (const [check, patterns] of workflows) {
      if (pathMatches(patterns, path)) {
        expected.push(check)
      }
    }
    assert.deepEqual(
      buildReport({ paths: [path], body: 'Risk-Level: HIGH' }).checks,
      expected,
      path,
    )
  }
})

test('문서 전용 PR은 경량 검사를 유지하고 요청 진입점 혼합 PR은 제품 검사 포함', () => {
  const docs = ['README.md', 'docs/pr-review-policy.md', 'services/api/docs/career-seasons.md']
  const workflows = [workflowPaths('backend-foundation'), workflowPaths('browser-e2e')]
  assert.deepEqual(buildReport({ paths: docs, body: 'Risk-Level: LOW' }).checks, [governance])
  for (const patterns of workflows) {
    assert.ok(!docs.some((path) => pathMatches(patterns, path)))
    assert.ok([...docs, 'proxy.ts'].some((path) => pathMatches(patterns, path)))
  }
  const mixed = buildReport({ paths: [...docs, 'proxy.ts'], body: 'Risk-Level: HIGH' })
  assert.equal(mixed.minimum, 'HIGH')
  assert.deepEqual(mixed.checks, bothProducts)
})

test('대표 경로의 최소 위험도와 영향 영역', () => {
  for (const path of [
    'README.md',
    'docs/pr-review-policy.md',
    'services/api/docs/economy-settlement.md',
    'app/globals.css',
    'public/icon.svg',
  ]) {
    assert.equal(classifyPath(path).level, 'LOW', path)
  }
  for (const path of [
    'components/career/stable.tsx',
    'lib/race-catalog/client.ts',
    'services/api/src/routes/events.ts',
    'future/unknown.ts',
  ]) {
    assert.equal(classifyPath(path).level, 'MEDIUM', path)
  }
  for (const path of [
    'lib/career/local-economy.ts',
    'lib/career/race-sim-v4.ts',
    'lib/server-save/workspace.ts',
    'services/api/src/repositories/careers.ts',
    'services/api/src/modules/auth/oidc.ts',
    'services/api/src/modules/events/risk.ts',
    'services/api/src/db.ts',
    'services/api/src/contracts.ts',
    'services/api/src/services/identity.ts',
    'services/api/migrations/001_foundation.sql',
    'services/api/seeds/events.catalog.json',
    'packages/shared/src/client.ts',
    'contracts/openapi.yaml',
    'app/api/server-save/route.ts',
    '.env.example',
    'vercel.json',
    'services/api/vercel.json',
    '.github/workflows/pr-governance.yml',
    'scripts/pr-risk-report.mjs',
    'scripts/pr-risk-report.test.mjs',
    'middleware.ts',
    'future/authorization.ts',
    'future/schema.prisma',
  ]) {
    assert.equal(classifyPath(path).level, 'HIGH', path)
  }
  assert.deepEqual(classifyPath('lib/career/store.ts').areas, ['Frontend', 'Shared'])
})

test('유효한 선언과 높은 위험도 자발적 상향', () => {
  for (const level of ['LOW', 'MEDIUM', 'HIGH']) {
    assert.equal(parseDeclaredRisk(`Risk-Level: ${level}`).level, level)
  }
  const report = buildReport({
    paths: ['README.md'],
    body: 'Risk-Level: HIGH',
    enforceMetadata: true,
  })
  assert.equal(report.metadataFailed, false)
  assert.deepEqual(report.warnings, [])
})

test('누락·UNSET·소문자·중복·코드·주석 선언을 정상값으로 처리하지 않음', () => {
  for (const body of [
    null,
    '',
    'Risk-Level: UNSET',
    'Risk-Level: low',
    'Risk-Level: ',
    'Risk-Level: LOW\nRisk-Level: LOW',
    'Risk-Level: LOW\nRisk-Level: HIGH',
    '```text\nRisk-Level: HIGH\n```',
    '~~~~\nRisk-Level: HIGH\n~~~~',
    '<!-- Risk-Level: HIGH -->',
    '<!--\nRisk-Level: HIGH',
    '> Risk-Level: HIGH',
    '    Risk-Level: HIGH',
  ]) {
    assert.equal(parseDeclaredRisk(body).valid, false, String(body))
  }
  assert.equal(parseDeclaredRisk('```\nRisk-Level: UNSET\n```\nRisk-Level: MEDIUM').level, 'MEDIUM')
  assert.throws(() => parseDeclaredRisk({ level: 'HIGH' }))
})

test('신규 PR 누락은 실패, 경로 권장과의 차이는 경고, 기존 PR 호환 유지', () => {
  for (const body of ['', 'Risk-Level: UNSET', 'Risk-Level: LOW']) {
    const input = { paths: ['lib/career/store.ts'], body }
    const current = buildReport({ ...input, enforceMetadata: true })
    const legacy = buildReport(input)
    assert.equal(current.metadataFailed, body !== 'Risk-Level: LOW')
    assert.equal(legacy.metadataFailed, false)
    assert.equal(legacy.warnings.length, 1)
    assert.equal(legacy.minimum, 'HIGH')
  }
})

test('문서·거버넌스는 제품 검사 없이, 계약/런타임은 기존 검사 권장', () => {
  for (const path of [
    'README.md',
    'services/api/docs/career-seasons.md',
    'scripts/pr-risk-report.mjs',
    '.github/workflows/pr-governance.yml',
  ]) {
    assert.deepEqual(buildReport({ paths: [path], body: 'Risk-Level: HIGH' }).checks, [
      'PR governance: risk-report',
    ])
  }
  const report = buildReport({ paths: ['contracts/openapi.yaml'], body: 'Risk-Level: HIGH' })
  assert.equal(report.checks.length, 3)
  assert.ok(report.checks.some((check) => check.includes('catalog-chromium')))
})

test('200개 표시 제한/중복 제거가 전체 위험도 분석을 자르지 않음', () => {
  const paths = Array.from({ length: 3500 }, (_, index) => `docs/${index}.md`)
  paths.push('lib/career/store.ts', 'lib/career/store.ts')
  const report = buildReport({ paths, body: 'Risk-Level: HIGH' })
  assert.equal(report.files.length, 3501)
  assert.equal(report.minimum, 'HIGH')
  assert.match(renderSummary(report), /전체 3501개/)
})

test('악성 파일명/본문은 실행·HTML·Markdown 명령으로 렌더링하지 않음', () => {
  const path = 'docs/`$(touch PWNED)`<img src=x>|[link](evil)\n::error::x.md'
  const report = buildReport({ paths: [path], body: 'Risk-Level: $(touch PWNED)' })
  const summary = renderSummary(report)
  assert.equal(report.declared.valid, false)
  assert.ok(!summary.includes('<img'))
  assert.ok(!summary.includes('[link]'))
  assert.ok(!summary.includes('\n::error::'))
  assert.ok(!summary.includes('`$(touch'))
  assert.throws(() => buildReport({ paths: [null], body: '' }))
  assert.throws(() => buildReport({ paths: ['x\0y'], body: '' }))
  assert.throws(() => buildReport({ paths: null, body: '' }))
})

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'derby-pr-risk-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'develop')
  git('config', 'user.name', 'Risk test')
  git('config', 'user.email', 'risk-test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  const write = (path, text = 'fixture\n') => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true })
    writeFileSync(join(cwd, path), text)
  }
  const commit = (date) => {
    git('add', '.')
    execFileSync('git', ['commit', '-m', 'fixture'], {
      cwd,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      stdio: 'pipe',
    })
    return git('rev-parse', 'HEAD')
  }
  write('README.md')
  const initial = commit('2026-10-01T00:00:00Z')
  const event = (base, head, body = 'Risk-Level: HIGH', createdAt = '2026-10-27T00:00:00Z') => ({
    pull_request: { base: { sha: base }, head: { sha: head }, body, created_at: createdAt },
  })
  return { cwd, git, write, commit, initial, event }
}

test('도입 전 base는 기존 PR을 차단하지 않으며 빈 diff도 처리', (t) => {
  const r = repository(t)
  const report = readPullRequest(r.event(r.initial, r.initial, ''), r.cwd)
  assert.equal(report.enforceMetadata, false)
  assert.equal(report.declared.valid, false)
  assert.deepEqual(report.files, [])
})

test('base 정책 도입 시각으로 신규/기존 PR 구분 (본문으로 우회 불가)', (t) => {
  const r = repository(t)
  r.write('docs/pr-review-policy.md')
  const base = r.commit('2026-10-26T00:00:00Z')
  r.write('lib/career/store.ts')
  const head = r.commit('2026-10-27T00:00:00Z')
  assert.equal(readPullRequest(r.event(base, head, ''), r.cwd).metadataFailed, true)
  assert.equal(
    readPullRequest(r.event(base, head, '', '2026-10-25T00:00:00Z'), r.cwd).enforceMetadata,
    false,
  )
  assert.equal(
    readPullRequest(r.event(base, head, 'Risk-Level: HIGH'), r.cwd).metadataFailed,
    false,
  )
  assert.equal(
    readPullRequest(r.event(base, head, 'Risk-Level: UNSET\ncreated_at: 2000-01-01'), r.cwd)
      .metadataFailed,
    true,
  )
})

test('정책 feature 작성일 대신 develop 병합 시각을 도입 기준으로 사용', (t) => {
  const r = repository(t)
  r.git('switch', '-c', 'policy')
  r.write('docs/pr-review-policy.md')
  r.commit('2026-10-10T00:00:00Z')
  r.git('switch', 'develop')
  execFileSync('git', ['merge', '--no-ff', 'policy', '-m', 'adopt policy'], {
    cwd: r.cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-10-26T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-10-26T00:00:00Z',
    },
    stdio: 'pipe',
  })
  const base = r.git('rev-parse', 'HEAD')
  const report = readPullRequest(r.event(base, base, '', '2026-10-20T00:00:00Z'), r.cwd)
  assert.equal(Date.parse(report.adoptedAt), Date.parse('2026-10-26T00:00:00Z'))
  assert.equal(report.enforceMetadata, false)
})

test('3-dot diff는 base 전용 변경을 제외하고 삭제/이름변경의 원본 위험을 보존', (t) => {
  const r = repository(t)
  r.write('lib/career/store.ts')
  const common = r.commit('2026-10-02T00:00:00Z')
  r.git('switch', '-c', 'feature')
  r.write('docs/placeholder.md')
  r.git('mv', 'lib/career/store.ts', 'docs/moved.md')
  r.write('docs/space \n`$(echo bad)`.md')
  const head = r.commit('2026-10-03T00:00:00Z')
  r.git('switch', 'develop')
  r.write('only-on-base.ts')
  const base = r.commit('2026-10-04T00:00:00Z')
  assert.notEqual(base, common)
  const report = readPullRequest(r.event(base, head), r.cwd)
  assert.equal(report.minimum, 'HIGH')
  assert.ok(report.files.some((file) => file.path === 'lib/career/store.ts'))
  assert.ok(report.files.some((file) => file.path === 'docs/moved.md'))
  assert.ok(report.files.some((file) => file.path.includes('\n`$(echo bad)`')))
  assert.ok(!report.files.some((file) => file.path === 'only-on-base.ts'))
})

test('잘못된 이벤트/SHA/시각/없는 commit은 분석 오류', (t) => {
  const r = repository(t)
  for (const event of [
    {},
    r.event('--help', r.initial),
    r.event(r.initial, '$(echo bad)'),
    r.event([r.initial], r.initial),
    r.event(r.initial, r.initial, '', 'invalid'),
    r.event('a'.repeat(40), r.initial),
  ]) {
    assert.throws(() => readPullRequest(event, r.cwd))
  }
})

test('Summary 저장 실패도 분석 실패 exit 2이며 성공으로 숨기지 않음', (t) => {
  const r = repository(t)
  const eventFile = join(r.cwd, 'event.json')
  writeFileSync(eventFile, JSON.stringify(r.event(r.initial, r.initial)))
  const result = spawnSync(process.execPath, [script], {
    cwd: r.cwd,
    env: { ...process.env, GITHUB_EVENT_PATH: eventFile, GITHUB_STEP_SUMMARY: r.cwd },
    encoding: 'utf8',
  })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /summary write failed/)
  assert.match(result.stderr, /risk analysis failed/)
})

test('CLI exit 0/1/2와 Summary가 메타데이터/분석 오류를 구분', (t) => {
  const r = repository(t)
  r.write('docs/pr-review-policy.md')
  const base = r.commit('2026-10-26T00:00:00Z')
  r.write('lib/career/store.ts')
  const head = r.commit('2026-10-27T00:00:00Z')
  const eventFile = join(r.cwd, 'event.json')
  const summaryFile = join(r.cwd, 'summary.md')
  for (const [payload, exitCode, expected] of [
    [JSON.stringify(r.event(base, head)), 0, '메타데이터 결과: 유효'],
    [JSON.stringify(r.event(base, head, 'Risk-Level: UNSET')), 1, '메타데이터 결과: 실패'],
    [JSON.stringify(r.event(base, head, 'Risk-Level: LOW')), 0, '메타데이터 결과: 경고'],
    ['{bad json', 2, '분석 실패'],
    [JSON.stringify({}), 2, '분석 실패'],
  ]) {
    writeFileSync(eventFile, payload)
    writeFileSync(summaryFile, '')
    const result = spawnSync(process.execPath, [script], {
      cwd: r.cwd,
      env: { ...process.env, GITHUB_EVENT_PATH: eventFile, GITHUB_STEP_SUMMARY: summaryFile },
      encoding: 'utf8',
    })
    assert.equal(result.status, exitCode, result.stderr)
    assert.ok(readFileSync(summaryFile, 'utf8').includes(expected))
  }
})
