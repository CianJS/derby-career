import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm, cp, symlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeRacingCatalog, digest } from '../../src/modules/racing/catalog'
import { readRacingSource } from '../../src/modules/racing/import'
import { sapporoPilot } from '../../../../packages/shared/src/sapporo-pilot'
test('Sapporo release verification isolates a test-only Local entry manifest', async () => {
  const { deriveApprovedPlayable } = await import('../../src/modules/racing/mapping-release')
  const { mappingSourceFacts, mappingDecisionFields } =
    await import('../../../../packages/shared/src/race-mapping')
  const catalog = normalizeRacingCatalog(
    await readRacingSource(['seeds/racing.notion.source.json']),
  )
  const reference = catalog.races.find((r) => r.id === sapporoPilot.source.id)!
  const course = catalog.courses.find((c) => c.id === sapporoPilot.courseModel.id)!
  const definition = sapporoPilot.definition
  const body = {
    version: 1,
    referenceId: reference.id,
    gameDefinitionId: definition.id,
    state: 'approved',
    sourceDigest: digest(reference),
    source: mappingSourceFacts(reference),
    definitionDigest: digest(definition),
    definition,
    courseId: course.id,
    courseDigest: digest(course),
    courseSnapshot: course,
    eligibility: { minAge: 2, maxAge: 2, sex: 'any', minWins: 1, maxWins: null },
    calendar: {
      referenceYear: 2026,
      firstGameYear: 2028,
      seasonMonth: 9,
      policy: 'repeat_season_month',
    },
    economy: { entryFee: 750000, firstPrize: 65000000, currency: 'KRW', basis: 'game_balance' },
    opponents: { profile: 'sapporo-g3-2yo-v1', runners: 14 },
    decisions: Object.fromEntries(
      mappingDecisionFields.map((k) => [
        k,
        {
          status: 'approved',
          reference: 'https://example.invalid/test-only',
          reviewer: 'fixture-only',
        },
      ]),
    ),
  }
  const mapping = { ...body, revision: digest(body) }
  assert.throws(
    () => deriveApprovedPlayable([mapping], catalog.races, catalog.courses),
    /Release approval/,
  )
  assert.throws(
    () =>
      deriveApprovedPlayable(
        [{ ...mapping, sourceDigest: '0'.repeat(64) }],
        catalog.races,
        catalog.courses,
        true,
      ),
    /Mapping rejected/,
  )
  const entries = deriveApprovedPlayable([mapping], catalog.races, catalog.courses, true)
  assert.equal(entries.length, 1)
  const root = join(process.cwd(), '../..')
  const tmp = await mkdtemp(join(tmpdir(), 'derby-sapporo-test-'))
  try {
    await cp(root, tmp, {
      recursive: true,
      filter: (path) => !/(?:^|\/)(?:node_modules|\.git|\.next|dist)(?:\/|$)/.test(path),
    })
    await symlink(join(root, 'node_modules'), join(tmp, 'node_modules'), 'dir')
    await symlink(
      join(root, 'services/api/node_modules'),
      join(tmp, 'services/api/node_modules'),
      'dir',
    )
    await writeFile(
      join(tmp, 'packages/shared/src/approved-playable.json'),
      JSON.stringify(entries, null, 2) + '\n',
    )
    // The ordinary release check must reject the test-only registry if it is copied into a build.
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          "import { checkApprovedPlayable } from './scripts/check-approved-playable.ts'; await checkApprovedPlayable()",
        ],
        {
          cwd: join(tmp, 'services/api'),
          stdio: 'pipe',
          timeout: 60000,
          env: { ...process.env, NODE_TEST_CONTEXT: undefined },
        },
      ),
    )
    const output = execFileSync(
      process.execPath,
      [
        '--import',
        './services/api/node_modules/tsx/dist/loader.mjs',
        '--test',
        'tests/helpers/sapporo-local-fixture.ts',
      ],
      {
        cwd: tmp,
        encoding: 'utf8',
        timeout: 60000,
        env: { ...process.env, NODE_TEST_CONTEXT: undefined },
      },
    )
    assert.match(output, /pass 1/)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
  assert.equal(await readFile('../../packages/shared/src/approved-playable.json', 'utf8'), '[]\n')
})
