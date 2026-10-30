import type { RaceDefinitionSnapshot } from '../../../lib/career/race-entry'

/** Review-only proposal: never add to a live race catalog without the separate approvals. */
export const sapporoPilot = {
  state: 'candidate',
  source: {
    id: 'RACE_JPN_2026_JRA_075',
    digest: '4ccc0dce5efcece5fe4e01dd943b567d2310cba4ea5b6ea9928e2ecc2b0c8e6d',
    officialDate: '2026-09-05',
    firstPrizeJPY: 34000000,
    evidence: 'https://japanracing.jp/en/racing/schedule/graded/list/2026.html',
  },
  courseModel: {
    id: 'CO_JPN_SAPPORO_TURF_T_C',
    digest: 'a6c3028e8378c3ad2b780fd2a05eec8d385a8b72a19d1b69dabc8efbd47e83fa',
    evidence: 'https://www.jra.go.jp/facilities/race/sapporo/course/index.html',
    status: 'proposed_game_model',
    actual2026Rail: 'unconfirmed',
  },
  gameRulesStatus: 'proposed',
  proposal: 'https://github.com/CianJS/derby-career/issues/100#issuecomment-6510882594',
  definition: {
    id: 'JPN_SAPPORO_NISAI_G3',
    name: 'SAPPORO NISAI STAKES',
    countryCode: 'JPN',
    month: 9,
    surface: 'Turf',
    distance: 1800,
    raceClass: 'G3',
    runners: 14,
    courseProfile: '札幌 잔디 대표 모델 (2026 레일 미확인)',
    prize: 65000000,
    entryFee: 750000,
    minWins: 1,
    minAge: 2,
    maxAge: 2,
  } satisfies RaceDefinitionSnapshot,
} as const
