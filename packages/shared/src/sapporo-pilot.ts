/** Review-only proposal: never add to a live race catalog without the separate approvals. */
export const sapporoPilot = {
  state: 'candidate',
  source: {
    id: 'RACE_JPN_2026_JRA_075',
    digest: '4ccc0dce5efcece5fe4e01dd943b567d2310cba4ea5b6ea9928e2ecc2b0c8e6d',
    officialDate: '2026-09-05',
    firstPrizeJPY: 34000000,
    evidence: 'https://japanracing.jp/en/racing/schedule/graded/list/2026/0905sapporo-nisai.html',
  },
  courseModel: {
    id: 'CO_JPN_SAPPORO_TURF_T_C',
    digest: 'a6c3028e8378c3ad2b780fd2a05eec8d385a8b72a19d1b69dabc8efbd47e83fa',
    evidence: 'https://www.jra.go.jp/facilities/race/sapporo/course/index.html',
    status: 'official_program_planned',
    planned2026Rail: 'C',
    planEvidence: 'https://www.jra.go.jp/keiba/program/2026/pdf/bangumi/sapporo2.pdf',
    actual2026Rail: 'unconfirmed',
  },
  gameRulesStatus: 'unresolved',
  proposal: 'https://github.com/CianJS/derby-career/issues/100#issuecomment-6538884133',
  // Identity only. An entry definition cannot be published until the currency,
  // affiliation, selection and actual-field policies are explicitly approved.
  definition: {
    id: 'JPN_SAPPORO_NISAI_G3',
  },
} as const
