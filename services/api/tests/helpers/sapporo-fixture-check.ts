import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm, cp, symlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeRacingCatalog, digest } from '../../src/modules/racing/catalog'
import { readRacingSource } from '../../src/modules/racing/import'
import { sapporoPilot } from '../../../../packages/shared/src/sapporo-pilot'
import { sapporoLegacyDefinition } from '../../../../tests/helpers/sapporo-legacy-definition'
test('Sapporo release verification isolates a test-only Local entry manifest', async () => {
  const { deriveApprovedPlayable, deriveApprovedHistory, assertHistoryAppendOnly } =
    await import('../../src/modules/racing/mapping-release')
  const { mappingSourceFacts, mappingDecisionFields } =
    await import('../../../../packages/shared/src/race-mapping')
  const catalog = normalizeRacingCatalog(
    await readRacingSource(['seeds/racing.notion.source.json']),
  )
  const reference = catalog.races.find((r) => r.id === sapporoPilot.source.id)!
  const course = catalog.courses.find((c) => c.id === sapporoPilot.courseModel.id)!
  const definition = sapporoLegacyDefinition
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
  // Synthetic reviewer is test data only; satisfying the old decision format
  // must not activate the withdrawn economy/entry policy in a release build.
  const evidenceOnlyBody = {
    ...body,
    decisions: Object.fromEntries(
      mappingDecisionFields.map((key) => [
        key,
        {
          status: 'approved',
          reference: 'https://github.com/CianJS/derby-career/issues/100#issuecomment-6538884133',
          reviewer: 'synthetic',
        },
      ]),
    ),
  }
  const evidenceOnlyMapping = { ...evidenceOnlyBody, revision: digest(evidenceOnlyBody) }
  assert.throws(
    () => deriveApprovedPlayable([evidenceOnlyMapping], catalog.races, catalog.courses),
    /activation blocked/,
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
  const revisedDefinition = { ...definition, entryFee: 800000, prize: 66000000 }
  const revisedBody = {
    ...body,
    definition: revisedDefinition,
    definitionDigest: digest(revisedDefinition),
    economy: { ...body.economy, entryFee: 800000, firstPrize: 66000000 },
  }
  const revised = { ...revisedBody, revision: digest(revisedBody) }
  const revisedEntries = deriveApprovedPlayable([revised], catalog.races, catalog.courses, true)
  assert.notEqual(entries[0].revision, revisedEntries[0].revision)
  const archiveInput = [
    { mapping, reference, course },
    { mapping: revised, reference, course },
  ]
  assert.doesNotThrow(() => assertHistoryAppendOnly([archiveInput[0]], archiveInput))
  assert.throws(
    () => assertHistoryAppendOnly(archiveInput, [archiveInput[1]]),
    /removed or changed/,
  )
  assert.throws(
    () => assertHistoryAppendOnly([archiveInput[0]], [{ ...archiveInput[0], mapping: revised }]),
    /removed or changed/,
  )
  assert.deepEqual(deriveApprovedHistory(archiveInput, true), [...entries, ...revisedEntries])
  assert.throws(() => deriveApprovedHistory(archiveInput), /Release approval/)
  assert.throws(() => deriveApprovedHistory([archiveInput[0], archiveInput[0]], true), /Duplicate/)
  assert.throws(
    () =>
      deriveApprovedHistory(
        [{ ...archiveInput[0], course: { ...course, notes: 'tampered' } }],
        true,
      ),
    /Mapping rejected/,
  )
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
    await writeFile(
      join(tmp, 'packages/shared/src/approved-playable-history.json'),
      JSON.stringify([...entries, ...revisedEntries], null, 2) + '\n',
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
    if (!process.env.SAPPORO_TEST_POSTGRES) {
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
          env: {
            ...process.env,
            NODE_TEST_CONTEXT: undefined,
            SAPPORO_TEST_ALT: JSON.stringify(revisedEntries),
          },
        },
      )
      assert.match(output, /pass 1/)
    }
    // Synthetic approval is injected only into this temporary source copy. Release code
    // keeps the stricter evidence checks and the real manifest remains empty.
    await writeFile(
      join(tmp, 'services/api/config/approved-race-mappings.json'),
      JSON.stringify([mapping]),
    )
    let server: string
    try {
      server = execFileSync(
        process.execPath,
        ['--import', 'tsx', '--test', 'tests/helpers/sapporo-server-fixture.ts'],
        {
          cwd: join(tmp, 'services/api'),
          encoding: 'utf8',
          timeout: 60000,
          env: { ...process.env, NODE_TEST_CONTEXT: undefined },
        },
      )
    } catch (error) {
      const details = error as { stdout?: string; stderr?: string }
      const secret = process.env.SAPPORO_TEST_POSTGRES
      const output = `${details.stdout ?? ''}\n${details.stderr ?? ''}`
      assert.fail(secret ? output.split(secret).join('[redacted database URL]') : output)
    }
    assert.match(server, /pass 1/)
    if (process.env.SAPPORO_TEST_POSTGRES) {
      const restartFile = join(tmp, 'sapporo-restart-state.json')
      const runPhase = (phase: 'prepare' | 'restart') => {
        try {
          const output = execFileSync(
            process.execPath,
            ['--import', 'tsx', '--test', 'tests/helpers/sapporo-server-restart-fixture.ts'],
            {
              cwd: join(tmp, 'services/api'),
              encoding: 'utf8',
              timeout: 60000,
              env: {
                ...process.env,
                NODE_TEST_CONTEXT: undefined,
                SAPPORO_RESTART_STATE: restartFile,
                SAPPORO_RESTART_PHASE: phase,
              },
            },
          )
          assert.match(output, /pass 1/)
        } catch (error) {
          const details = error as { stdout?: string; stderr?: string }
          const output = `${details.stdout ?? ''}\n${details.stderr ?? ''}`
          assert.fail(
            output.split(process.env.SAPPORO_TEST_POSTGRES!).join('[redacted database URL]'),
          )
        }
      }
      runPhase('prepare')
      await writeFile(
        join(tmp, 'packages/shared/src/approved-playable.json'),
        JSON.stringify(revisedEntries, null, 2) + '\n',
      )
      await writeFile(
        join(tmp, 'services/api/config/approved-race-mappings.json'),
        JSON.stringify([revised]),
      )
      runPhase('restart')
      console.log('SAPPORO_NATIVE_RESTART_PASSED')
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
  assert.equal(await readFile('../../packages/shared/src/approved-playable.json', 'utf8'), '[]\n')
})
