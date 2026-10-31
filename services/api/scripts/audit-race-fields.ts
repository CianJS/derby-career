import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { sapporoOfficialFacts } from '../../../packages/shared/src/sapporo-official-facts'

// Inventory of the repository snapshot, not a claim of independent verification.
// Parent row supplies sourceId, source URL/page and applicable year to each field.
type SourceRow = Record<string, unknown>
type PlayabilityRow = { sourceRaceId: string; reasons: string[] }
type AuditField = { oldValue: unknown; newValue: null; verificationStatus: string }

const sourceBytes = await readFile('seeds/racing.notion.source.json')
const source = JSON.parse(sourceBytes.toString('utf8')) as {
  capturedAt: string
  races: SourceRow[]
}
const playability = JSON.parse(await readFile('reports/race-playability.json', 'utf8')) as {
  sourceDigest: string
  referenceRows: number
  publicDistinctRows: number
  countries: Record<string, number>
  reasonCounts: Record<string, number>
  rows: PlayabilityRow[]
}
const baseline = new Map(playability.rows.map((row) => [row.sourceRaceId, row]))
const baselineReasonOrder = Object.keys(playability.reasonCounts)
if (source.races.length !== 851 || baseline.size !== 851 || playability.referenceRows !== 851) {
  throw new Error('Unexpected input row count or duplicate report IDs')
}

const value = (row: SourceRow, key: string): unknown => {
  const v = row[key]
  return v === undefined || v === null || v === '' || v === '미확인' ? null : v
}
const field = (v: unknown): AuditField => ({
  oldValue: v,
  newValue: null,
  verificationStatus: v === null ? '누락' : '수집됨·개별검증대기',
})
const stats: Record<string, Record<string, number>> = {}
const sourceLevelStatuses: Record<string, number> = {}
let fieldOrder: string[] | undefined
const rows = source.races.map((raw) => {
  const id = value(raw, '경주 ID')
  if (typeof id !== 'string') {
    throw new Error('Missing source race ID')
  }
  const existing = baseline.get(id)
  if (!existing) {
    throw new Error(`Report does not contain ${id}`)
  }
  const money = value(raw, '공식 상금액')
  const sourceStatus = value(raw, '검토 상태')
  const sourceStatusKey = typeof sourceStatus === 'string' ? sourceStatus : '미기록'
  sourceLevelStatuses[sourceStatusKey] = (sourceLevelStatuses[sourceStatusKey] ?? 0) + 1
  const basis = value(raw, '상금 기준')
  const note = value(raw, '메모')
  const distanceFromNote =
    typeof note === 'string' ? (note.match(/원문 거리\s+([^;()]+)/)?.[1]?.trim() ?? null) : null
  // The source records only one amount and basis. Never relabel total purse as first prize.
  const fields: Record<string, AuditField> = {
    name: field(value(raw, '경주명')),
    year: field(value(raw, '기준연도')),
    country: field(value(raw, '국가')),
    grade: field(value(raw, '등급')),
    date: field(value(raw, 'date:실제 개최일:start')),
    result: field(null),
    originalDistanceAndUnit: field(distanceFromNote),
    normalizedDistanceMeters: field(value(raw, '거리(m)')),
    surface: field(value(raw, '노면')),
    racecourseId: field(value(raw, '경마장 ID')),
    racecourseRelation: field(value(raw, '경마장')),
    courseId: field(null),
    direction: field(null),
    ageSexCondition: field(value(raw, '연령·성별 조건')),
    affiliationEligibility: field(null),
    selection: field(null),
    weight: field(null),
    maximumRunners: field(value(raw, '최대 출전두수')),
    actualRunners: field(null),
    stagedEntryFee: field(null),
    sourceMoneyAmount: field(money),
    sourceMoneyBasis: field(basis),
    sourceCurrency: field(value(raw, '상금 통화')),
    firstPrize: field(basis === '1착' ? money : null),
    placingPrizes2to5: field(null),
    totalPurse: field(basis === '총상금' ? money : null),
    additionalPrize: field(null),
    earningsQualification: field(null),
    sourceUrl: field(value(raw, '공식 출처')),
    sourcePage: field(null),
    sourceVerificationDate: field(null),
  }
  for (const [name, item] of Object.entries(fields)) {
    const counts = (stats[name] ??= {})
    counts[item.verificationStatus] = (counts[item.verificationStatus] ?? 0) + 1
  }
  const names = Object.keys(fields)
  fieldOrder ??= names
  if (JSON.stringify(fieldOrder) !== JSON.stringify(names)) {
    throw new Error('Inconsistent field order')
  }
  return {
    sourceId: id,
    applicableYear: value(raw, '기준연도'),
    evidenceUrl: value(raw, '공식 출처'),
    evidencePage: null,
    sourceLevelStatus: sourceStatus,
    reviewPriority:
      id === 'RACE_JPN_2026_JRA_075'
        ? 'P0'
        : existing.reasons.some((reason) =>
              ['duplicate_review', 'source_not_verified', 'date_unconfirmed'].includes(reason),
            )
          ? 'P1'
          : 'P2',
    oldValues: names.map((name) => fields[name].oldValue),
    statusCodes: names.map((name) => (fields[name].oldValue === null ? 'M' : 'P')).join(''),
    // Existing baseline block reasons describe game support, not source-field verification.
    baselineGameBlockReasonIndexes: existing.reasons.map((reason) => {
      const index = baselineReasonOrder.indexOf(reason)
      if (index < 0) {
        throw new Error(`Unknown baseline reason: ${reason}`)
      }
      return index
    }),
    ...(id === sapporoOfficialFacts.sourceId
      ? {
          sourceCorrectionVersion: sapporoOfficialFacts.version,
          sourceCorrections: sapporoOfficialFacts.corrections,
          correctionUnresolved: sapporoOfficialFacts.unresolved,
        }
      : {}),
  }
})
if (new Set(rows.map((row) => row.sourceId)).size !== 851) {
  throw new Error('Duplicate source IDs')
}
const report = {
  version: 'race-field-audit-v1',
  sourceSnapshotCapturedAt: source.capturedAt,
  sourceSnapshotSha256: createHash('sha256').update(sourceBytes).digest('hex'),
  baselineReportSourceDigest: playability.sourceDigest,
  fieldOrder,
  baselineReasonOrder,
  fieldEncoding: {
    oldValues:
      'oldValues[i] belongs to fieldOrder[i]; null means no structured value in this snapshot',
    statusCodes: 'statusCodes[i]: M=누락, P=수집됨·개별검증대기',
    newValue:
      'newValue is null unless a row has an explicit sourceCorrections entry for the field.',
    provenance:
      'Each field inherits sourceId, evidenceUrl, evidencePage and applicableYear from its row; the URL is not independently verified here.',
    baselineGameBlockReasonIndexes:
      'Each index refers to baselineReasonOrder; source notes remain available in the original snapshot by sourceId.',
  },
  summary: {
    sourceRows: rows.length,
    publicDistinctRows: playability.publicDistinctRows,
    countries: playability.countries,
    sourceLevelStatuses,
    baselineGameBlockReasonCounts: playability.reasonCounts,
    independentFieldChecksPerformedByAudit: 0,
    sourceCorrectionRows: 1,
    sourceCorrectionEvidenceItems: sapporoOfficialFacts.corrections.length,
    newlyVerifiedByAuditFields: 0,
    playable: 0,
    fieldStatuses: stats,
  },
  interpretation: [
    '수집됨·개별검증대기 means a value exists in the preserved source snapshot; it does not assert independent fact verification.',
    '누락 means absent or not structured in the source snapshot, not that the real-world information is absent.',
    'Source-level review labels do not establish that every field is verified; conflict status requires field-specific evidence.',
    'The baseline playability reasons are historical game-support findings and do not establish a source-fact error.',
    'courseId is null in the baseline normalizer; unassigned course is not proof that the source has no course information.',
    'Snapshot oldValues remain unchanged; the separately verified Sapporo correction layer supplies its versioned newValue and evidence, while other corrections remain unverified.',
    'Evidence URL is inherited from the source row; page and field-specific independent verification remain pending except for the separate Sapporo correction evidence.',
    'originalDistanceAndUnit is extracted from source notes where explicitly labeled 원문 거리; a missing direct racecourseId does not imply that the source has no racecourseRelation.',
    'P0 is the explicitly selected Sapporo pilot; P1 flags existing duplicate, source-verification or date concerns; P2 is all remaining rows. Priorities do not imply the other fields are correct.',
  ],
  rows,
}
await writeFile('reports/race-field-audit.json', JSON.stringify(report) + '\n')
const priorities = rows.reduce<Record<string, number>>((counts, row) => {
  counts[row.reviewPriority] = (counts[row.reviewPriority] ?? 0) + 1
  return counts
}, {})
const correctionDisplay: Record<string, { label: string; scope: string; page: string }> = {
  courseDirection: { label: '회전 방향', scope: '공식 경주 일정에 기재된 방향', page: '경주 상세' },
  plannedTurfCourse: {
    label: '계획된 잔디 코스',
    scope: '시행계획; 당일 변경 여부 미확인',
    page: '시행계획 1쪽',
  },
  officialMaximumStarters: {
    label: '공식 최대 출전두수',
    scope: '정원이며 실제 인원과 별개',
    page: '경주 상세',
  },
  actualStarters: {
    label: '2026년 실제 출전두수',
    scope: '해당 회차 결과; 향후 기본 인원 아님',
    page: '공식 결과 착순 1~9',
  },
  'specialRegistrationJPY.central.first': {
    label: '중앙마 특별등록료 1단계',
    scope: '중앙마 일정; 자격별 조건 별도',
    page: '시행계획 2쪽',
  },
  'specialRegistrationJPY.central.second': {
    label: '중앙마 특별등록료 2단계',
    scope: '중앙마 일정; 자격별 조건 별도',
    page: '시행계획 2쪽',
  },
  foreignPaymentJPY: {
    label: '해외마 납부액',
    scope: '해외 일정; 모든 소속의 단일 단계 아님',
    page: '국제 일정 8월 28일 납부',
  },
  'officialPrizeJPY.place1': {
    label: '1착 본상금',
    scope: '1착 본상금',
    page: '시행계획 1쪽 제11경주',
  },
  'officialPrizeJPY.place2': {
    label: '2착 본상금',
    scope: '2착 본상금',
    page: '시행계획 1쪽 제11경주',
  },
  'officialPrizeJPY.place3': {
    label: '3착 본상금',
    scope: '3착 본상금',
    page: '시행계획 1쪽 제11경주',
  },
  'officialPrizeJPY.place4': {
    label: '4착 본상금',
    scope: '4착 본상금',
    page: '시행계획 1쪽 제11경주',
  },
  'officialPrizeJPY.place5': {
    label: '5착 본상금',
    scope: '5착 본상금',
    page: '시행계획 1쪽 제11경주',
  },
  'internationalSchedule.baseWeightKg': {
    label: '국제 일정 기준 부담중량',
    scope: '기준 중량; 감량과 소속별 조건 별도',
    page: '국제 일정 중량 항목',
  },
}
const correctionRows = sapporoOfficialFacts.corrections.map((item) => {
  const display = correctionDisplay[item.field]
  if (!display) {
    throw new Error(`Missing human-readable correction label: ${item.field}`)
  }
  let newValue = String(item.newValue)
  if (typeof item.newValue === 'number') {
    const unit = item.field.includes('JPY')
      ? '엔'
      : item.field === 'internationalSchedule.baseWeightKg'
        ? 'kg'
        : '두'
    newValue = `${item.newValue.toLocaleString('en-US')}${unit}`
  } else if (item.field === 'courseDirection') {
    newValue = '우회전'
  } else if (item.field === 'plannedTurfCourse') {
    newValue = 'C코스'
  }
  return `| ${display.label} | ${newValue} | ${display.scope} | [JRA 근거](${item.evidenceUrl}) · ${display.page} |`
})
const markdown = [
  '# 경주 851행 필드 감사·교정 대기표',
  '',
  `기준: 보존된 원본 스냅샷 ${source.capturedAt}, 원본 SHA-256 \`${report.sourceSnapshotSha256}\`. 재생성: \`cd services/api && node --import tsx scripts/audit-race-fields.ts\`.`,
  '',
  '**이 감사는 저장소 자료의 필드 재고 조사다. 851개 경주를 외부 원문으로 전수 검증하지 않았다.** 851행 세부 원값·상태·출처와 보정 대기는 [race-field-audit.json](race-field-audit.json)에 있다. 원본 스냅샷을 변경하지 않는다.',
  '',
  `- 전체 ${rows.length}행: 한국 ${playability.countries.KOR}, 일본 ${playability.countries.JPN}, 미국 ${playability.countries.USA}; 기존 공개 distinct ${playability.publicDistinctRows}건. ID와 중복 관계는 기존 기준을 유지한다.`,
  `- 원본에 기록된 **행 단위** 검토 상태: 공식 확인 ${sourceLevelStatuses['공식 확인']}, 부분 확인 ${sourceLevelStatuses['부분 확인']}, 재검토 ${sourceLevelStatuses['재검토']}. 각 필드를 독립 확인했다는 뜻은 아니다.`,
  `- 우선순위: P0 삿포로 파일럿 ${priorities.P0}행, P1 기존 중복·출처·날짜 확인 필요 ${priorities.P1}행, P2 나머지 ${priorities.P2}행. P2가 정확하다는 뜻은 아니다.`,
  `- 삿포로 보정 계층 ${sapporoOfficialFacts.version}: 1행 ${sapporoOfficialFacts.corrections.length}개 근거 항목. 이 감사 자체가 추가로 외부 확인한 필드는 0개다. 실제 승인 registry는 비어 있어 playable 0/851이다.`,
  '',
  '## 필드 상태와 게임 지원은 별개',
  '',
  '원본에 값이 있으면 `수집됨·개별검증대기`, 없거나 구조화되지 않았으면 `누락`으로 표시한다. 원본의 행 단위 공식 확인을 필드별 확인으로 바꾸지 않는다. 출처 충돌은 필드별 증거가 확보된 경우에만 판정한다. 별도 삿포로 보정은 각 항목의 `verificationStatus`, URL·페이지·적용연도·증거 범위를 보존한다.',
  '',
  '기존 `race-playability.json`의 게임 차단 사유는 참고 당시의 엔진/매핑 상태이며 사실값 오류가 아니다. 중복 집계이며 현재 PR의 G3 지원 상태와 동일하다고 가정하지 않는다. 게임 조정·엔진 미지원 여부는 원본 사실 상태와 별도로 결정한다.',
  '',
  '| 원본 스냅샷 필드 | 구조화된 값 또는 명시적 메모 | 스냅샷에 부재/미구조화 |',
  '| --- | ---: | ---: |',
  ...[
    ['개최일', 'date'],
    ['원문 거리·단위 (명시된 메모 추출)', 'originalDistanceAndUnit'],
    ['직접 경마장 ID', 'racecourseId'],
    ['경마장 관계값', 'racecourseRelation'],
    ['최대 출전두수', 'maximumRunners'],
    ['기록된 공식 상금액', 'sourceMoneyAmount'],
    ['1착 금액으로 기록된 상금', 'firstPrize'],
    ['총상금으로 기록된 금액', 'totalPurse'],
  ].map(
    ([label, key]) =>
      `| ${label} | ${stats[key]['수집됨·개별검증대기'] ?? 0} | ${stats[key]['누락'] ?? 0} |`,
  ),
  '',
  '원문 거리·단위는 명시된 메모에서만 추출했다. 직접 경마장 ID가 비어 있어도 관계값은 있을 수 있다. 기존 정규화는 courseId를 null로 고정하므로 코스 미연결 851건을 원문 부재 851건으로 해석하면 안 된다. 공식 총상금 539건은 1착 상금으로 바꾸지 않는다. 누락은 무료·0·무제한을 뜻하지 않는다.',
  '',
  '## 삿포로 2026 보정 사실',
  '',
  `sourceId: \`${sapporoOfficialFacts.sourceId}\`; 확인일: ${sapporoOfficialFacts.verifiedOn}. 상세는 보정 계층과 JSON의 \`sourceCorrections\`를 따른다.`,
  '',
  '| 필드 | 보정값 | 근거 범위 | 출처 |',
  '| --- | --- | --- | --- |',
  ...correctionRows,
  '',
  '최대 14두와 실제 2026년 결과 9두는 별개다. 9두를 미래 게임의 기본 출전 수로 정하지 않는다. C코스는 시행계획이며 당일 변경 여부는 별도 확인이 필요하다. 등록료의 중앙마 단계와 해외마 납부 일정을 혼동하지 않는다. 1~5착은 본상금이며 총상금·부가상금·수득상금과 게임 보상은 별개다.',
  '',
  'JRA·NAR·해외마의 상세 신청 자격과 초과 신청 시 선발은 별도 확인·정책 결정이 필요하다. 게임 통화환산율·공통 축소계수·반올림은 미확정이다. Notion 삿포로 1행은 보정 v1과 공식 최대 14두·실제 9두를 동기화하고 재조회했다. 나머지 850행은 이번 지시에 따른 개별 외부 조사·보정 전이다.',
  '',
].join('\n')
await writeFile('reports/race-field-audit.md', markdown)
console.log(JSON.stringify(report.summary))
