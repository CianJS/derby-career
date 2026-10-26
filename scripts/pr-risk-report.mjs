import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const LEVELS = ['LOW', 'MEDIUM', 'HIGH']
const POLICY_PATH = 'docs/pr-review-policy.md'
const BACKEND = 'Backend foundation: verify, verify-vercel, verify-frontend'
const BROWSER = 'Browser E2E: catalog-chromium'
const GOVERNANCE = 'PR governance: risk-report'
const SHA = /^[a-f0-9]{40}$/

function isGovernanceScript(path) {
  return /^scripts\/pr-risk-report(?:\.test)?\.mjs$/.test(path)
}

function isDocument(path) {
  return /\.md$/i.test(path)
}

export function classifyPath(path) {
  if (typeof path !== 'string' || !path || path.includes('\0')) {
    throw new Error('변경 파일 경로가 유효하지 않음')
  }
  const areas = []
  if (/^(app|components|lib|public)\//.test(path)) {
    areas.push('Frontend')
  }
  if (path.startsWith('services/api/')) {
    areas.push('Backend')
  }
  if (/^(contracts|packages\/shared|lib\/career)\//.test(path)) {
    areas.push('Shared')
  }
  if (
    /^(\.github|scripts|tests)\//.test(path) ||
    /config\./.test(path) ||
    /(^|\/)(vercel\.json|\.env(?:\..*)?|package(?:-lock)?\.json|pnpm-(lock|workspace)\.yaml|\.editorconfig|\.prettier(rc\.json|ignore)|\.npmrc|Dockerfile|\.dockerignore)$/.test(
      path,
    )
  ) {
    areas.push('CI')
  }
  if (isDocument(path)) {
    areas.push('Docs')
    return { path, level: 'LOW', areas, reason: '문서; 실행 설정·게임 규칙 변경 여부는 내용 리뷰' }
  }

  const high =
    /^(lib\/(career|server-save)|packages\/shared\/src|contracts)\//.test(path) ||
    /^services\/api\/(src\/(repositories|modules\/(auth|events|racing))|migrations|seeds)\//.test(
      path,
    ) ||
    /^services\/api\/src\/(config|contracts|db|services\/(identity|migrations|seed))\.ts$/.test(
      path,
    ) ||
    /^services\/api\/scripts\/(deployment-db|build-vercel)\.[cm]?[jt]s$/.test(path) ||
    /^app\/api\/server-save\//.test(path) ||
    /(^|\/)(auth|authentication|authorization|permissions|sessions)([./-]|$)/i.test(path) ||
    /(^|\/)(middleware|proxy)\.[cm]?[jt]s$/.test(path) ||
    /(^|\/)(migrations?|seeds?)\//.test(path) ||
    /\.(sql|prisma)$/.test(path) ||
    /(^|\/)(\.env(?:\..*)?|vercel\.json|Dockerfile(?:\..*)?|\.dockerignore|\.npmrc)$/.test(path) ||
    /^\.github\//.test(path) ||
    isGovernanceScript(path) ||
    /^scripts\/(race-audit|race-golden|legacy-field)\.ts$/.test(path) ||
    /^scripts\/dev-server-save\.mjs$/.test(path)

  const style = /\.(css|scss|sass|less|png|jpe?g|gif|webp|ico|svg|woff2?)$/i.test(path)
  return {
    path,
    level: high ? 'HIGH' : style ? 'LOW' : 'MEDIUM',
    areas: areas.length ? areas : ['Other'],
    reason: high
      ? '저장·게임 계산·계약·DB·인증 또는 CI/환경/배포 설정 후보'
      : style
        ? '스타일·이미지 후보; 동작·접근성·보안 영향은 내용 리뷰'
        : '일반 코드/설정 또는 미분류 경로; 의미적 위험은 내용 리뷰',
  }
}

export function parseDeclaredRisk(body) {
  if (body === null || body === undefined) {
    body = ''
  }
  if (typeof body !== 'string') {
    throw new Error('PR 본문은 문자열 또는 null이어야 함')
  }
  // Do not accept a declaration hidden in a template comment or a code example.
  const lines = body.replace(/<!--[\s\S]*?(?:-->|$)/g, '').split(/\r?\n/)
  const declarations = []
  let fence = null
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (marker) {
      if (!fence) {
        fence = marker[1]
      } else if (
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      ) {
        fence = null
      }
      continue
    }
    if (!fence) {
      const declaration = /^ {0,3}Risk-Level:\s*(.*?)\s*$/.exec(line)
      if (declaration) {
        declarations.push(declaration[1])
      }
    }
  }
  const valid = declarations.length === 1 && LEVELS.includes(declarations[0])
  return {
    level: valid ? declarations[0] : null,
    valid,
    reason: valid
      ? '유효'
      : declarations.length === 0
        ? 'Risk-Level 누락'
        : declarations.length > 1
          ? 'Risk-Level 중복'
          : 'Risk-Level은 LOW / MEDIUM / HIGH 중 하나여야 함 (UNSET은 무효)',
  }
}

function recommendedChecks(paths) {
  const checks = new Set([GOVERNANCE])
  for (const path of paths) {
    if (isDocument(path) || isGovernanceScript(path)) {
      continue
    }
    // These are review recommendations, not a second test runner or a claim that CI ran.
    if (
      /^(app|components|lib|public|services\/api|packages\/shared|contracts)\//.test(path) ||
      /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|next\.config\.mjs|postcss\.config\.mjs|tsconfig\.json|playwright\.config\.ts)$/.test(
        path,
      )
    ) {
      checks.add(BACKEND)
      checks.add(BROWSER)
    } else if (/^(scripts|tests)\//.test(path)) {
      checks.add(BACKEND)
      if (/^(tests\/e2e\/|scripts\/(run|prepare)-browser-e2e\.mjs$)/.test(path)) {
        checks.add(BROWSER)
      }
    } else if (
      /^(vercel\.json|tsconfig\.frontend-integration\.json|\.gitignore|\.env\.example|\.editorconfig|\.prettier(?:rc\.json|ignore))$/.test(
        path,
      ) ||
      path === '.github/workflows/backend-foundation.yml'
    ) {
      checks.add(BACKEND)
    } else if (path === '.github/workflows/browser-e2e.yml') {
      checks.add(BROWSER)
    }
  }
  return [...checks]
}

export function buildReport({ paths, body, enforceMetadata = false, base, head, adoptedAt }) {
  if (!Array.isArray(paths)) {
    throw new Error('변경 파일 목록은 배열이어야 함')
  }
  const files = [...new Set(paths)].map(classifyPath)
  const minimum = files.reduce(
    (level, file) => (LEVELS.indexOf(file.level) > LEVELS.indexOf(level) ? file.level : level),
    'LOW',
  )
  const declared = parseDeclaredRisk(body)
  const warnings = []
  if (!declared.valid) {
    warnings.push(declared.reason)
  } else if (LEVELS.indexOf(declared.level) < LEVELS.indexOf(minimum)) {
    warnings.push(`선언 ${declared.level}이 경로 기반 최소 권장 ${minimum}보다 낮음`)
  }
  return {
    base,
    head,
    adoptedAt,
    files,
    minimum,
    declared,
    enforceMetadata,
    warnings,
    // Path risk is advisory; only invalid required metadata fails this check.
    // Product workflows never use the declared risk to select or skip tests.
    metadataFailed: enforceMetadata && !declared.valid,
    areas: [...new Set(files.flatMap((file) => file.areas))].sort(),
    checks: recommendedChecks(files.map((file) => file.path)),
  }
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd()
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) {
    throw new Error('PR/정책 생성 시각이 유효하지 않음')
  }
  const time = Date.parse(value)
  if (!Number.isFinite(time)) {
    throw new Error('PR/정책 생성 시각이 유효하지 않음')
  }
  return time
}

export function readPullRequest(event, cwd = process.cwd()) {
  const pr = event?.pull_request
  if (
    !pr ||
    typeof pr.base?.sha !== 'string' ||
    typeof pr.head?.sha !== 'string' ||
    !SHA.test(pr.base.sha) ||
    !SHA.test(pr.head.sha)
  ) {
    throw new Error('pull_request와 40자리 base/head SHA가 필요함')
  }
  const createdAt = timestamp(pr.created_at)
  // --no-renames retains the old AND new paths: moving a repository to docs stays HIGH.
  // Three-dot diff excludes changes made only on develop; NUL preserves arbitrary filenames.
  const raw = git(
    ['diff', '--name-only', '-z', '--no-renames', `${pr.base.sha}...${pr.head.sha}`, '--'],
    cwd,
  )
  const paths = raw ? raw.split('\0').filter(Boolean) : []
  // The first-parent addition on BASE records policy adoption, not a date supplied in the PR body.
  // Before adoption (including this bootstrap PR), metadata is advisory for compatibility.
  const adoptedAt =
    git(
      [
        'log',
        '--first-parent',
        '--diff-filter=A',
        '-1',
        '--format=%cI',
        pr.base.sha,
        '--',
        POLICY_PATH,
      ],
      cwd,
    ) || null
  return buildReport({
    paths,
    body: pr.body,
    base: pr.base.sha,
    head: pr.head.sha,
    adoptedAt,
    enforceMetadata: adoptedAt !== null && createdAt >= timestamp(adoptedAt),
  })
}

function safeText(value) {
  // Untrusted filenames/errors must not become Markdown links, HTML, tables or workflow commands.
  return String(value).replace(
    /[&<>|`\[\]*_\\\r\n\u0000-\u001f\u007f]/g,
    (character) => `&#${character.charCodeAt(0)};`,
  )
}

export function renderSummary(report) {
  const lines = [
    '## PR 위험도 보고',
    '',
    `Base: ${safeText(report.base ?? '입력 사례')} · Head: ${safeText(report.head ?? '입력 사례')}`,
    '',
    `- 선언 위험도: **${report.declared.level ?? 'INVALID'}** (${report.declared.reason})`,
    `- 경로 기반 최소 권장 위험도: **${report.minimum}**`,
    `- 영향 영역: ${report.areas.join(', ') || '변경 없음'}`,
    `- 메타데이터 적용: ${report.enforceMetadata ? '정책 도입 후 신규 PR — 필수' : '기존/도입 PR — 경고만 (무효 값을 유효로 인정하지 않음)'}`,
    `- 정책 도입 시각 (base 첫 부모 이력): ${safeText(report.adoptedAt ?? '아직 없음')}`,
    `- 메타데이터 결과: ${report.metadataFailed ? '실패' : report.warnings.length ? '경고' : '유효'}`,
    '',
    '### 확인할 기존 검사',
    '',
    ...report.checks.map((check) => `- ${check}`),
    '',
    '이 보고서는 제품 검사를 실행하거나 성공을 확인하지 않는다. PR Checks에서 최신 head의 실행·결과·로그 링크를 확인한다. 누락/대기/실패를 성공으로 보고하지 않는다.',
    '목록은 검토 권장 사항이며 실제 trigger 보장이 아니다. 미분류 경로·HIGH 변경은 기존 workflow의 paths와 실제 diff를 함께 검토한다. 문서/스타일도 의미에 따라 위험도를 올릴 수 있다.',
    '',
    ...(report.warnings.length
      ? ['### 경고', '', ...report.warnings.map((warning) => `- ${warning}`), '']
      : []),
    '### 변경 파일',
    '',
    '| 경로 | 최소 권장 | 영역 | 근거 |',
    '| --- | --- | --- | --- |',
    ...report.files
      .slice(0, 200)
      .map(
        (file) =>
          `| ${safeText(file.path)} | ${file.level} | ${file.areas.join(', ')} | ${file.reason} |`,
      ),
    '',
    `전체 ${report.files.length}개 경로를 분석했으며 표는 최대 200개를 표시한다. Git diff 전체를 사용하며 API 300/3,000개 파일 제한으로 잘라 분석하지 않는다.`,
    '',
    '경로 분석은 안전성 보증·독립 AI 리뷰·사용자 승인을 대신하지 않는다. Required Check/저장소 설정을 변경하지 않으며 자동 병합하지 않는다.',
    '',
  ]
  return lines.join('\n')
}

export function main(env = process.env) {
  try {
    if (!env.GITHUB_EVENT_PATH) {
      throw new Error('GITHUB_EVENT_PATH가 필요함 (PR 이벤트 JSON 파일)')
    }
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
    const report = readPullRequest(event)
    if (env.GITHUB_STEP_SUMMARY) {
      appendFileSync(env.GITHUB_STEP_SUMMARY, renderSummary(report))
    }
    console.log(JSON.stringify(report, null, 2))
    if (report.warnings.length) {
      console.log('::warning::PR risk metadata requires review. See the Job Summary.')
    }
    return report.metadataFailed ? 1 : 0
  } catch (error) {
    const detail = safeText(error instanceof Error ? error.message : '알 수 없는 오류')
    const summary = `## PR 위험도 분석 실패\n\n${detail}\n\n분석 도구/입력 오류이며 제품 테스트 결과가 아니다. 위험도나 검사 성공을 추정하지 않는다.\n`
    if (env.GITHUB_STEP_SUMMARY) {
      try {
        appendFileSync(env.GITHUB_STEP_SUMMARY, summary)
      } catch (summaryError) {
        console.error(`PR risk summary write failed: ${safeText(summaryError.message)}`)
      }
    }
    console.error(`PR risk analysis failed: ${detail}`)
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
