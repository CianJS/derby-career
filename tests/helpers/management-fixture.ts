import { legacyCareer as startCareer } from './legacy-career'

import { applyCareer } from '../../lib/career/lifecycle'
import { fixtureLifecycle } from '../../lib/career/fixtures'
import type { CareerHorse } from '../../components/career/legacy-types'

/** Synthetic saved records only; never loaded by the application. Newest record is first. */
export function managementFixture() {
  const career = { ...startCareer('DEV_HORSE_SERENE_STEP'), calendarDate: { year: 2035, month: 9 } }
  const lifecycle = {
    ...fixtureLifecycle(true),
    ...applyCareer({ activeHorse: null, month: 9 }, career),
    stableName: '보존할 마방',
    year: 2035,
    archive: fixtureLifecycle(true).archive.map((horse, index): CareerHorse => ({
      ...horse,
      name: '같은 이름',
      retiredAt: index === 0 ? '2035.09' : '2035.08',
      stats: horse.stats.map(([name, value]) => [String(name), Number(value)]),
      aptitude: horse.aptitude.map(([group, label, grade]) => [group, label, grade]),
    })),
  }
  return { career, lifecycle }
}
