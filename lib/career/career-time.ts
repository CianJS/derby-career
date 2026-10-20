export const CAREER_BASE_TURNS = 60
export const CAREER_SEASON_TURNS = 12

export type CareerProgress = {
  turn: number
  baseTurns: number
  seasonIndex: number
  seasonTurn: number
  age: number
  extended: boolean
}

/** Career seasons start with the horse, independently of the stable's calendar year. */
export function careerProgress(turn: number): CareerProgress {
  if (!Number.isSafeInteger(turn) || turn < 1) {
    throw new Error('저장된 육성 턴이 유효하지 않습니다.')
  }
  const seasonIndex = Math.floor((turn - 1) / CAREER_SEASON_TURNS) + 1
  return {
    turn,
    baseTurns: CAREER_BASE_TURNS,
    seasonIndex,
    seasonTurn: ((turn - 1) % CAREER_SEASON_TURNS) + 1,
    age: seasonIndex + 1,
    extended: turn > CAREER_BASE_TURNS,
  }
}

/** Inclusive next occurrence; a season boundary never ends the playable schedule. */
export function nextSeasonRaceTurn(turn: number, seasonTurns: readonly number[]): number | null {
  const { seasonTurn } = careerProgress(turn)
  if (seasonTurns.length === 0) {
    return null
  }
  if (
    seasonTurns.some(
      (month) => !Number.isInteger(month) || month < 1 || month > CAREER_SEASON_TURNS,
    )
  ) {
    throw new Error('경주 시즌 차수가 유효하지 않습니다.')
  }
  const delta = Math.min(
    ...seasonTurns.map((month) => (month - seasonTurn + CAREER_SEASON_TURNS) % CAREER_SEASON_TURNS),
  )
  const next = turn + delta
  careerProgress(next)
  return next
}

/** Only normalize live aggregates. Never call this on an archive or a locked race snapshot. */
export function normalizeCareerAge<T extends { age: number; careerTurnIndex: number }>(
  career: T,
): T {
  const { age } = careerProgress(career.careerTurnIndex)
  return career.age === age ? career : { ...career, age }
}
