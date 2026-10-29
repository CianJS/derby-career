import {
  contractedRoster,
  entryRestriction,
  localRacesForTurn,
  nextSeasonRaceTurn,
  raceDefinitions,
  localOverseasRaces,
  raceEligibility,
  type RaceDefinitionSnapshot,
} from '../../packages/shared/src/domain'
import { stableFunds, stableTravel, type useCareer } from '../../lib/career/store'

type Snapshot = ReturnType<typeof useCareer>
export type GameEntrySelection = { raceId: string; context: string }
export function entryBrowseContext(snapshot: Snapshot, mode = snapshot.mode): string {
  const career = snapshot.career
  const travel = stableTravel(snapshot)
  const options = snapshot.raceOptions
  return JSON.stringify([
    mode,
    snapshot.mode,
    snapshot.localCareerId,
    snapshot.workspace?.career?.id,
    career?.horse.id,
    career?.careerTurnIndex,
    snapshot.workspace?.career?.revision,
    career?.action?.actionId,
    career?.raceRun?.raceRunId,
    stableFunds(snapshot),
    travel && [
      travel.homeCountry,
      travel.locationCountry,
      travel.revision,
      travel.activeExpedition?.id,
    ],
    career?.contractedJockeyIds,
    career?.health,
    career?.healthRecovery,
    career?.values,
    options && [
      options.career.id,
      options.career.revision,
      options.restrictionReason,
      options.races.map((row) => [
        row.definition.id,
        row.definition.month,
        row.definition.entryFee,
        row.definition.prize,
        row.eligible,
        row.restrictionReason,
      ]),
      options.jockeys.map((jockey) => [jockey.id, jockey.chemistry]),
      options.tactics,
    ],
  ])
}
export function readEntrySelection(value: unknown): GameEntrySelection | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    !('raceId' in value) ||
    !('context' in value) ||
    typeof value.raceId !== 'string' ||
    typeof value.context !== 'string'
  ) {
    return undefined
  }
  return { raceId: value.raceId, context: value.context }
}
export type GameRaceRow = {
  definition: RaceDefinitionSnapshot
  turn: number | null
  current: boolean
  canPrepare: boolean
  reason: string
  moneyKnown: boolean
}

/** Presentation only: occurrences/eligibility come from the existing common domain or server DTO. */
export function gameRaceSchedule(snapshot: Snapshot, mode = snapshot.mode) {
  const career = snapshot.mode === mode ? snapshot.career : null
  const funds = stableFunds(snapshot)
  const travel = stableTravel(snapshot)
  const options = snapshot.raceOptions
  const serverKnown =
    mode !== 'server' ||
    (!!snapshot.workspace &&
      !!options &&
      options.career.id === snapshot.workspace.career?.id &&
      options.career.revision === snapshot.workspace.career?.revision)
  const unknown =
    snapshot.mode !== mode ||
    !mode ||
    !snapshot.ready ||
    snapshot.busy ||
    snapshot.pending ||
    !!snapshot.error ||
    !career ||
    !serverKnown ||
    (mode === 'local' && (funds === null || !travel))
  const message =
    snapshot.mode !== mode || !snapshot.ready || snapshot.busy || snapshot.pending
      ? '저장 상태와 출전 정보를 확인하고 있습니다. 0개로 확정된 상태가 아닙니다.'
      : (snapshot.error ??
        (!career
          ? '육성마를 선택하면 현재 말의 출전 조건을 확인할 수 있습니다.'
          : unknown
            ? '출전 정보를 아직 확인하지 못했습니다. 0개로 확정된 상태가 아닙니다.'
            : null))
  const definitions = [...raceDefinitions, ...localOverseasRaces]
  const current =
    !unknown && career
      ? mode === 'server'
        ? (options?.races.map((row) => row.definition) ?? [])
        : localRacesForTurn(career.careerTurnIndex)
      : []
  const all = new Map(definitions.map((definition) => [definition.id, definition]))
  for (const definition of current) {
    all.set(definition.id, definition)
  }
  const rows: GameRaceRow[] = [...all.values()]
    .map((base) => {
      const actual = current.find((row) => row.id === base.id)
      const turn = career
        ? (actual?.month ?? nextSeasonRaceTurn(career.careerTurnIndex, [base.month]))
        : null
      const isCurrent = !!actual && actual.month === career?.careerTurnIndex
      const definition = actual ?? base
      let reason: string
      if (unknown || !career) {
        reason = message ?? '출전 정보 확인 필요'
      } else if (!isCurrent) {
        reason =
          turn === career.careerTurnIndex && mode === 'server'
            ? '서버가 이번 달 출전 후보로 제공하지 않은 경주입니다.'
            : '예정 경주입니다. 해당 턴에 건강·국가·전적·자금·계약 조건을 다시 확인합니다.'
      } else if (mode === 'server') {
        const row = options!.races.find((row) => row.definition.id === definition.id)!
        reason =
          options!.restrictionReason ??
          row.restrictionReason ??
          (!row.eligible
            ? '서버가 출전 불가로 판정했습니다.'
            : career.action || career.raceRun
              ? '이번 달 행동·출전을 이미 확정했습니다.'
              : snapshot.workspace?.career?.event?.state === 'pending'
                ? '서버 이벤트 선택을 먼저 확정해 주세요.'
                : !options!.jockeys.length || !options!.tactics.length
                  ? '서버 계약 기수·전술 정보를 확인해 주세요.'
                  : '')
      } else {
        reason =
          raceEligibility(career, definition, funds!, travel!) ??
          entryRestriction(career, funds!, travel!) ??
          (!contractedRoster(career).length ? '계약 기수가 없습니다.' : '')
      }
      return {
        definition,
        turn,
        current: isCurrent,
        canPrepare: !unknown && isCurrent && !reason,
        reason: reason || '현재 말로 출전 준비 가능 · 확정 전 다시 확인합니다.',
        moneyKnown: mode === 'local' || (!!actual && !unknown),
      }
    })
    .sort(
      (a, b) =>
        Number(b.current) - Number(a.current) || (a.turn ?? Infinity) - (b.turn ?? Infinity),
    )
  return {
    rows,
    message,
    known: !unknown,
    definitionCount: definitions.length,
    currentCount: unknown ? null : current.length,
    readyCount: unknown ? null : rows.filter((row) => row.canPrepare).length,
  }
}
