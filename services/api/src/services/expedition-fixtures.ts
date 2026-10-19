import { raceDefinitions } from '../../../../packages/shared/src/domain'

// Explicit development game fixtures, independent of official 851-row reference schedules.
const base = raceDefinitions.find((r) => r.id === 'DEV_M3_MILE_1600')!
export const expeditionFixtures = [
  { ...base, id: 'DEV_JPN_M3_MILE_1600', name: '일본 원정 마일 (개발용)', countryCode: 'JPN' },
  { ...base, id: 'DEV_USA_M3_MILE_1600', name: '미국 원정 마일 (개발용)', countryCode: 'USA' },
]
