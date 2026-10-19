import { countryName } from '../career/local-travel'
import { applyCareer, type LifecycleHorse } from '../career/lifecycle'
import type { SaveWorkspace } from './controller'

/** Presentation only: it never resolves growth, events, money or retirement on the client. */
export function serverLifecycle(workspace: SaveWorkspace) {
  const horse = (state: NonNullable<SaveWorkspace['career']>) => {
    const projected = applyCareer<{ activeHorse: LifecycleHorse | null; month: number }>(
      { activeHorse: null, month: state.state.calendarDate.month },
      state.state,
    ).activeHorse!
    return { ...projected, id: state.ownedHorseId }
  }
  return {
    country: workspace.stable?.travel
      ? countryName(workspace.stable.travel.homeCountry)
      : '정보 없음',
    activeHorse: workspace.career ? horse(workspace.career) : null,
    archive: workspace.retirements.map((record) => ({
      ...horse(record.snapshot),
      id: record.careerId,
      retiredAt: `${record.retiredOn.year}.${String(record.retiredOn.month).padStart(2, '0')}`,
    })),
    funds: `₩${(workspace.stable?.funds ?? 0).toLocaleString('ko-KR')}`,
    year: workspace.stable?.calendarDate.year ?? 2028,
    month: workspace.stable?.calendarDate.month ?? 4,
    recentActivity: [],
    postRace: null,
    lastRetiredId: workspace.retirements[0]?.careerId,
  }
}
