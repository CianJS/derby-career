import {
  validateRaceRunResponse,
  validateRaceLogResponse,
} from '../../packages/shared/src/generated/save-validation.mjs'
import type { DerbyApiClient } from '../../packages/shared/src/client'
import type { Career } from './model'
import type { RaceRunInput } from './race-entry'
import { readRaceLog } from './race-log-repository'
import { validateRaceLog, type RaceSimulationLog } from './race-simulation'

export type RaceData = { run: RaceRunInput; log: RaceSimulationLog }
export type RaceDataAdapter = {
  load: (career: Career, careerId?: string) => Promise<RaceData>
}

/** Read-only boundary. Neither adapter simulates a race or applies its rewards. */
export function createRaceDataAdapter(
  mode: 'local' | 'server',
  api: Pick<DerbyApiClient, 'getRaceRun' | 'getRaceLog'>,
  localLog: typeof readRaceLog = readRaceLog,
): RaceDataAdapter {
  return {
    async load(career, careerId) {
      const run = career.raceRun
      if (!run) {
        throw new Error('저장된 출전 정보가 없습니다.')
      }
      if (mode === 'local') {
        const log = localLog(run.raceRunId)
        validateRaceLog(log, run)
        return { run, log }
      }
      if (!careerId) {
        throw new Error('서버 육성 기록을 불러와 주세요.')
      }
      const response = await api.getRaceRun(careerId, run.raceRunId)
      if (!validateRaceRunResponse(response)) {
        throw new Error('서버 출전 응답을 읽지 못했습니다.')
      }
      const saved = response.raceRun as RaceRunInput
      if (
        saved.raceRunId !== run.raceRunId ||
        canonical(saved) !== canonical(run) ||
        !saved.simulation ||
        response.metadata.digest !== saved.simulation.digest
      ) {
        throw new Error('서버 출전 정보가 변경되었습니다. 최신 육성 기록을 불러와 주세요.')
      }
      const responseLog = await api.getRaceLog(careerId, run.raceRunId)
      if (!validateRaceLogResponse(responseLog)) {
        throw new Error('서버 경주 로그 응답을 읽지 못했습니다.')
      }
      validateRaceLog(responseLog.log, saved)
      return { run: saved, log: responseLog.log }
    },
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']'
  }
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(value)
}
