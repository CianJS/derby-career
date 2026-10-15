import type { Query } from '../db'
import { ApiError, notFound } from '../errors'
import { readCareerRow } from './career-rows'
import {
  raceLogDigest,
  type RaceSimulationLog,
  type RaceRunInput,
} from '../../../../packages/shared/src/domain'

type StoredSimulation = { log_json: string; digest: string; engine_version: string }
type RaceDataRow = StoredSimulation & {
  input: RaceRunInput
  health_at_entry: string
  duration_ms: number
  byte_length: number
  storage_version: number
}

export async function writeSimulationLog(
  tx: Query,
  runId: string,
  log: RaceSimulationLog,
): Promise<void> {
  const logJson = JSON.stringify(log)
  await tx.query(
    'INSERT INTO race_simulation_logs(race_run_id,engine_version,digest,duration_ms,byte_length,log,log_json) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      runId,
      log.engineVersion,
      raceLogDigest(log),
      log.durationMs,
      Buffer.byteLength(logJson),
      logJson,
      logJson,
    ],
  )
}

export async function readSimulationLog(
  tx: Query,
  runId: string,
  engineVersion: string,
): Promise<RaceSimulationLog> {
  const stored = (
    await tx.query<StoredSimulation>('SELECT * FROM race_simulation_logs WHERE race_run_id=$1', [
      runId,
    ])
  ).rows[0]
  if (!stored) {
    throw new ApiError(500, 'CORRUPT_LOG', '저장된 경주 로그를 확인할 수 없습니다.')
  }
  // The exact stored JSON, rather than JSONB field order or a new simulation, defines the digest.
  const exactLog: RaceSimulationLog = JSON.parse(stored.log_json)
  if (stored.digest !== raceLogDigest(exactLog) || stored.engine_version !== engineVersion) {
    throw new ApiError(500, 'CORRUPT_LOG', '저장된 경주 로그를 확인할 수 없습니다.')
  }
  return exactLog
}

export async function readRaceData(
  db: Query,
  owner: string,
  id: string,
  runId: string,
  log = false,
) {
  await readCareerRow(db, owner, id)
  const run = (
    await db.query<RaceDataRow>(
      'SELECT r.*,l.digest,l.duration_ms,l.byte_length,l.storage_version,l.log_json FROM race_runs r JOIN race_simulation_logs l ON l.race_run_id=r.id WHERE r.id=$1 AND r.career_id=$2',
      [runId, id],
    )
  ).rows[0]
  if (!run) {
    throw notFound()
  }
  return log
    ? { log: JSON.parse(run.log_json) }
    : {
        raceRun: run.input,
        healthAtEntry: run.health_at_entry,
        metadata: {
          engineVersion: run.engine_version,
          digest: run.digest,
          durationMs: run.duration_ms,
          byteLength: run.byte_length,
          storageVersion: run.storage_version,
        },
      }
}
