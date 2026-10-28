import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { auditEventQuality } from '../src/modules/events/quality-audit'
import { digest } from '../src/services/identity'
if (process.argv.length !== 2) {
  throw new Error('No output path or import arguments are supported')
}
const inputs = [
  'seeds/events.catalog.json',
  'seeds/events.expansion.catalog.json',
  'seeds/events.expansion.source.json',
  'seeds/events.import.json',
]
const raw = await Promise.all(inputs.map((p) => readFile(p, 'utf8')))
const [common, expansion, source, legacySource] = raw.map((s) => JSON.parse(s))
const protectedPaths = [
  ...inputs,
  '../../lib/career/events/fixtures.ts',
  '../../lib/career/balance.ts',
  '../../packages/shared/src/events.ts',
  '../../lib/career/events/director.ts',
  'src/modules/events/director.ts',
  'src/modules/events/resolver.ts',
]
const hash = async (p: string) =>
  createHash('sha256')
    .update(await readFile(p))
    .digest('hex')
const hashes = Object.fromEntries(
  await Promise.all(protectedPaths.map(async (p) => [p, await hash(p)])),
)
const result = auditEventQuality({
  common: common.events,
  expansion: expansion.events,
  source,
  legacySource,
})
const dir = 'review/event-v2'
await mkdir(dir, { recursive: true })
const detailFiles: { path: string; digest: string; ids: string[] }[] = []
const proposalFiles: { path: string; digest: string; ids: string[] }[] = []
for (let offset = 0; offset < 1000; offset += 100) {
  const part = String(offset / 100 + 1).padStart(2, '0')
  const records = result.report.records.slice(offset, offset + 100)
  const rows = result.packet.rows.slice(offset, offset + 100)
  for (const [name, value, files] of [
    [`records-${part}.json`, records, detailFiles],
    [`proposals-${part}.json`, rows, proposalFiles],
  ] as const) {
    await writeFile(`${dir}/${name}`, JSON.stringify(value, null, 2) + '\n')
    files.push({ path: name, digest: digest(value), ids: value.map((r) => r.id) })
  }
}
const { records: _records, ...reportMetadata } = result.report
const { rows: _rows, ...packetMetadata } = result.packet
for (const [name, value] of Object.entries({
  report: { ...reportMetadata, recordCount: 1000, files: detailFiles },
  packet: {
    ...packetMetadata,
    format: 'event-v2-review-manifest',
    packetFormat: result.packet.format,
    rowCount: 1000,
    files: proposalFiles,
  },
  distribution: result.distribution,
  preservation: { hashes, runtimeChanged: 0, activationAllowed: false },
})) {
  await writeFile(`${dir}/${name}.json`, JSON.stringify(value, null, 2) + '\n')
}
const csv = (v: unknown) => '"' + String(v ?? '').replaceAll('"', '""') + '"'
const header = [
  'id',
  'mode',
  'enabled',
  'category',
  'state',
  'priorities',
  'codes',
  'beforeStory',
  'afterStory',
  'beforeEffects',
  'afterEffects',
  'numericChanges',
  'manualReview',
  'balanceImpact',
]
await writeFile(
  `${dir}/inventory.csv`,
  [
    header.map(csv).join(','),
    ...result.report.records.map((r) =>
      [
        r.id,
        r.mode,
        r.server.enabled,
        r.server.category,
        r.proposal.state,
        r.findings.map((f) => f.priority).join('|'),
        r.findings.map((f) => f.code).join('|'),
        r.proposal.before.description,
        r.proposal.after.description,
        JSON.stringify(r.proposal.before.choices),
        JSON.stringify(r.proposal.after.choices),
        JSON.stringify(r.proposal.numericChanges),
        r.proposal.manualStoryReview,
        r.proposal.balanceImpact,
      ]
        .map(csv)
        .join(','),
    ),
  ].join('\n') + '\n',
)
const s = result.report.summary
await writeFile(
  `${dir}/COUNTS.md`,
  `# 전수 검사 결과\n\n공통 ${s.common}, 확장 ${s.expansion}, 총 ${s.total}, Local ${s.localFixtures}. 활성 공통 ${s.activeCommon}, 확장 ${s.activeExpansion}. 확장 실행 가능 표기 ${s.expansionExecutable}.\n\nA ${s.priorityCounts.A}, B ${s.priorityCounts.B}, C ${s.priorityCounts.C}개(중복 집계). 보류 ${s.hold}, 검토용 ${s.reviewOnly}, 수치 변경 후보 ${s.numericChangeCandidates}건. 즉시 승격 0, 사람의 스토리 검토 완료 0, 실제 활성 정의/계산 변경 0건.\n`,
)
for (const [p, h] of Object.entries(hashes)) {
  if ((await hash(p)) !== h) {
    throw Error('Input changed: ' + p)
  }
}
console.log(JSON.stringify(s))
