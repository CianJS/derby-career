import { randomUUID } from 'node:crypto'
import type { Database } from '../src/db'
import {
  horses,
  jockeyCatalog,
  raceDefinitions,
  startCareer,
  createRaceRun,
  simulateRace,
  summarizeRaceLog,
} from '../../../packages/shared/src/domain'
import { completeServerRace } from '../../../packages/shared/src/server-domain'
import { writeSimulationLog } from '../src/repositories/race-logs'
import { digest } from '../src/services/identity'

// Frozen pre-008 storage layout. No new application API is run against an unmigrated database.
export async function seedLegacyCatalog(db: Database) {
  for (const [table, definitions] of [
    ['horse_definitions', horses],
    ['jockey_definitions', jockeyCatalog],
    ['race_definitions', raceDefinitions],
  ] as const) {
    for (const definition of definitions) {
      await db.query(
        `INSERT INTO ${table}(id,payload,source_kind) VALUES($1,$2,'development_fixture') ON CONFLICT DO NOTHING`,
        [definition.id, JSON.stringify(definition)],
      )
    }
  }
}
export async function legacyRaceFixture(
  db: Database,
  owner: string,
  engineVersion: 'race-sim-v1' | 'race-sim-v2',
) {
  return db.transaction(async (tx) => {
    let stable = (await tx.query('SELECT * FROM stables WHERE owner_id=$1', [owner])).rows[0]
    if (!stable) {
      stable = (
        await tx.query('INSERT INTO stables(id,owner_id) VALUES($1,$2) RETURNING *', [
          randomUUID(),
          owner,
        ])
      ).rows[0]
    }
    for (const jockeyId of startCareer('DEV_HORSE_SERENE_STEP').contractedJockeyIds) {
      await tx.query(
        'INSERT INTO jockey_contracts(stable_id,jockey_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [stable.id, jockeyId],
      )
    }
    const id = randomUUID(),
      horseId = randomUUID()
    const state = startCareer('DEV_HORSE_SERENE_STEP')
    state.horse = { ...state.horse, id: horseId }
    state.careerTurnIndex = 3
    state.month = 3
    const body = {
      raceRunId: randomUUID(),
      raceDefinitionId: raceDefinitions[1].id,
      jockeyId: jockeyCatalog[1].id,
      tactic: '선입' as const,
      expectedTurn: 3,
      engineVersion,
    }
    const run = createRaceRun(
      state,
      raceDefinitions[1],
      jockeyCatalog[1],
      body.tactic,
      (() => {
        let first = true
        return () => {
          if (first) {
            first = false
            return body.raceRunId
          }
          return 'legacy-fixed-seed'
        }
      })(),
    )
    const log = simulateRace(run, engineVersion)
    run.simulation = summarizeRaceLog(log)
    state.raceRun = run
    const career = {
      id,
      stableId: stable.id,
      ownedHorseId: horseId,
      horseDefinitionId: 'DEV_HORSE_SERENE_STEP',
      status: 'active',
      revision: 1,
      authority: 'server',
      funds: Number(stable.funds),
      state: structuredClone(state),
      event: null,
    }
    const completed = completeServerRace(
      state,
      run.raceRunId,
      log.result.placing,
      log.result.prizeMoney,
    )
    await tx.query(
      'INSERT INTO owned_horses(id,stable_id,definition_id,definition_snapshot) VALUES($1,$2,$3,$4)',
      [horseId, stable.id, 'DEV_HORSE_SERENE_STEP', JSON.stringify(state.horse)],
    )
    await tx.query(
      "INSERT INTO careers(id,stable_id,owner_id,horse_id,turn,state,seed,status) VALUES($1,$2,$3,$4,$5,$6,$7,'retired')",
      [
        id,
        stable.id,
        owner,
        horseId,
        completed.careerTurnIndex,
        JSON.stringify(completed),
        'legacy-career-seed',
      ],
    )
    await tx.query(
      "INSERT INTO monthly_actions(id,career_id,horse_id,turn,kind,request_hash,resolved_at,result) VALUES($1,$2,$3,3,'race',$4,now(),$5)",
      [run.raceRunId, id, horseId, digest(body), JSON.stringify(log.result)],
    )
    await tx.query(
      'INSERT INTO race_runs(id,career_id,turn,action_id,race_definition_id,jockey_id,seed,engine_version,input,health_at_entry) VALUES($1,$2,3,$1,$3,$4,$5,$6,$7,$8)',
      [
        run.raceRunId,
        id,
        run.raceDefinitionSnapshot.id,
        body.jockeyId,
        run.raceSeed,
        engineVersion,
        JSON.stringify(run),
        state.health,
      ],
    )
    await writeSimulationLog(tx, run.raceRunId, log)
    await tx.query(
      'INSERT INTO race_results(race_run_id,career_id,finish_position,prize_money,result,career_record) VALUES($1,$2,$3,$4,$5,$6)',
      [
        run.raceRunId,
        id,
        log.result.placing,
        log.result.prizeMoney,
        JSON.stringify(log.result),
        JSON.stringify(completed.raceRecords[0]),
      ],
    )
    await tx.query(
      "INSERT INTO stable_ledger(id,stable_id,race_run_id,kind,amount) VALUES($1,$2,$3,'prize',$4)",
      [randomUUID(), stable.id, run.raceRunId, log.result.prizeMoney],
    )
    await tx.query('UPDATE stables SET funds=funds+$2 WHERE id=$1', [
      stable.id,
      log.result.prizeMoney,
    ])
    const response = { raceRunId: run.raceRunId, career }
    await tx.query(
      'INSERT INTO commands(principal_id,request_id,operation,career_id,request_hash,response) VALUES($1,$2,$3,$4,$5,$6)',
      [
        owner,
        run.raceRunId,
        'race.enter',
        id,
        digest({ operation: 'race.enter', careerId: id, body }),
        JSON.stringify(response),
      ],
    )
    return { id, body, response, log: JSON.stringify({ log }) }
  })
}
