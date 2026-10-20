import type { JockeySnapshot, RunningTactic } from './race-entry'

/** Game definitions, not a stable's contracts. Keep historical IDs and abilities unchanged. */
export const jockeyCatalog: JockeySnapshot[] = [
  {
    id: 'HAN_DOYUN',
    name: '한도윤',
    start: 86,
    pace: 78,
    path: 63,
    timing: 68,
    stability: 76,
    chemistry: 0,
    style: '도주·선행 / 초반 강점',
  },
  {
    id: 'SEO_JIAN',
    name: '서지안',
    start: 70,
    pace: 76,
    path: 88,
    timing: 84,
    stability: 72,
    chemistry: 0,
    style: '선입·추입 / 진로·승부 강점',
  },
  {
    id: 'YOON_TAESUNG',
    name: '윤태성',
    start: 74,
    pace: 82,
    path: 76,
    timing: 76,
    stability: 88,
    chemistry: 0,
    style: '균형 / 안정',
  },
  {
    id: 'PARK_SEOYUN',
    name: '박서윤',
    start: 80,
    pace: 72,
    path: 70,
    timing: 74,
    stability: 79,
    chemistry: 0,
    style: '선행 / 안정적인 기승',
  },
  {
    id: 'CHOI_MINJAE',
    name: '최민재',
    start: 66,
    pace: 80,
    path: 82,
    timing: 79,
    stability: 70,
    chemistry: 0,
    style: '선입 / 페이스 판단 강점',
  },
  {
    id: 'KANG_HAJUN',
    name: '강하준',
    start: 72,
    pace: 69,
    path: 74,
    timing: 88,
    stability: 68,
    chemistry: 0,
    style: '추입 / 승부 타이밍 강점',
  },
]

export const starterJockeyOptions = [
  { jockeyId: 'HAN_DOYUN', specialty: '도주' },
  { jockeyId: 'PARK_SEOYUN', specialty: '선행' },
  { jockeyId: 'CHOI_MINJAE', specialty: '선입' },
  { jockeyId: 'KANG_HAJUN', specialty: '추입' },
] as const satisfies readonly { jockeyId: string; specialty: RunningTactic }[]
export type StarterJockeyOption = (typeof starterJockeyOptions)[number]
export type StarterJockeyId = StarterJockeyOption['jockeyId']
export type JockeyContracts = { contractedJockeyIds: string[] }
export type CareerJockeySelection = {
  starterJockeyId?: string
  /** Existing saved contracts take precedence, including an explicitly empty list. */
  contractedJockeyIds?: readonly string[]
}
export function isStarterJockeyId(value: unknown): value is StarterJockeyId {
  return starterJockeyOptions.some((option) => option.jockeyId === value)
}
export function initialJockeyContracts(selection: CareerJockeySelection = {}): string[] {
  const { starterJockeyId, contractedJockeyIds } = selection
  if (starterJockeyId !== undefined && !isStarterJockeyId(starterJockeyId)) {
    throw new Error('초기 후보 기수 중 한 명을 선택해 주세요.')
  }
  if (contractedJockeyIds !== undefined) {
    if (starterJockeyId !== undefined && !contractedJockeyIds.includes(starterJockeyId)) {
      throw new Error('기존 마방의 기수 계약은 초기 선택으로 변경할 수 없습니다.')
    }
    return [...contractedJockeyIds]
  }
  return starterJockeyId === undefined ? [] : [starterJockeyId]
}
