import type { RaceDefinitionSnapshot } from '../../lib/career/race-entry'

// Historical R1 compatibility fixture only. These rejected amounts, field size and
// win requirement are not a proposed release definition or real-world facts.
export const sapporoLegacyDefinition: RaceDefinitionSnapshot = {
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
}
