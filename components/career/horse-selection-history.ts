import type { useCareer } from '../../lib/career/store'

/** Uses only the store's validated history, including its existing legacy Local read path. */
export function horseSelectionTitle(
  snapshot: Pick<
    ReturnType<typeof useCareer>,
    'ready' | 'busy' | 'pending' | 'error' | 'mode' | 'workspace' | 'lifecycle'
  >,
  historyUnknown = false,
): string {
  if (historyUnknown || !snapshot.ready || snapshot.error || snapshot.busy || snapshot.pending) {
    return '육성마를 선택하세요'
  }
  if (snapshot.mode === 'server') {
    const workspace = snapshot.workspace
    if (!workspace) {
      return '육성마를 선택하세요'
    }
    return workspace.retirements.length > 0 || workspace.pagination.total > 0
      ? '새 육성마를 선택하세요'
      : '첫 육성마를 선택하세요'
  }
  if (snapshot.mode === 'local') {
    const saved = snapshot.lifecycle
    if (saved?.archive?.length || saved?.lastRetiredId) {
      return '새 육성마를 선택하세요'
    }
    if (saved?.archive && !saved.activeHorse) {
      return '첫 육성마를 선택하세요'
    }
  }
  return '육성마를 선택하세요'
}
