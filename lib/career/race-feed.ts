import { frameAt, highlightText, type RaceSimulationLog } from './race-simulation'

export type FeedItem = { id: string; tMs: number; text: string }
export type KeyMoment = { id: string; label: string; text: string }

const MAX_FEED = 4
const REPEAT_WINDOW_MS = 9000
const LEAD_GAP_MS = 5000

const leaderAt = (log: RaceSimulationLog, tMs: number) => frameAt(log, tMs).runners.find(runner => runner.rank === 1)?.horseId

function leadChanges(log: RaceSimulationLog, names: Map<string, string>): FeedItem[] {
  const items: FeedItem[] = []
  let previous: string | undefined
  let lastAt = -Infinity
  for (const sample of log.samples) {
    if (sample.tMs < 8000 || sample.tMs > log.durationMs - 4000) continue
    const leader = leaderAt(log, sample.tMs)
    if (previous && leader && leader !== previous && sample.tMs - lastAt >= LEAD_GAP_MS) {
      items.push({ id: `lead-${sample.tMs}`, tMs: sample.tMs, text: `${names.get(leader) ?? ''}이(가) 선두로 나섭니다.` })
      lastAt = sample.tMs
    }
    previous = leader ?? previous
  }
  return items
}

/** 반복되는 막힘/진로확보는 한 번으로 합치고, 중요한 상황만 남긴다. */
export function significantFeed(log: RaceSimulationLog, names: Map<string, string>, upTo: number): FeedItem[] {
  const items: FeedItem[] = []
  let lastCongestionAt = -Infinity
  let lastCongestionType: string | null = null
  for (const highlight of log.highlights) {
    if (highlight.tMs > upTo) break
    const text = highlightText(highlight)
    if (!text) continue
    if (highlight.type === 'START') continue
    if (highlight.type === 'BLOCKED' || highlight.type === 'PATH_CLEAR') {
      const repeated = highlight.tMs - lastCongestionAt < REPEAT_WINDOW_MS
      const duplicate = lastCongestionType === highlight.type
      lastCongestionAt = highlight.tMs
      lastCongestionType = highlight.type
      if (repeated || duplicate) continue
    }
    items.push({ id: highlight.id, tMs: highlight.tMs, text })
  }
  for (const change of leadChanges(log, names)) if (change.tMs <= upTo) items.push(change)
  return items.sort((a, b) => a.tMs - b.tMs).slice(-MAX_FEED).reverse()
}

const PHASE_LABEL: Record<string, string> = { START: 'START', MID: 'MID', FINAL_CORNER: 'FINAL CORNER', STRETCH: 'STRETCH', FINISH: 'FINISH' }

/** 결과 화면용 핵심 장면. 고정 문구만 사용한다. */
export function keyMoments(log: RaceSimulationLog, playerHorseId: string): KeyMoment[] {
  const rankAt = (tMs: number) => frameAt(log, tMs).runners.find(runner => runner.horseId === playerHorseId)!.rank
  const marker = (phase: string) => log.phaseMarkers.find(item => item.phase === phase)
  const start = marker('START')
  const corner = marker('FINAL_CORNER')
  const stretch = marker('STRETCH')
  const startRank = rankAt(start?.tMs ?? 0)
  const cornerRank = corner ? rankAt(corner.tMs) : startRank
  const stretchRank = stretch ? rankAt(stretch.tMs) : cornerRank
  const placing = log.result.placing
  const moments: KeyMoment[] = []
  moments.push({ id: 'start', label: PHASE_LABEL.START, text: startRank <= 3 ? '좋은 출발로 선두권에 자리 잡았습니다.' : startRank >= Math.ceil(log.samples[0].runners.length * 0.6) ? '출발이 조금 늦었습니다.' : '무난하게 출발해 중위권에서 흐름을 탔습니다.' })
  if (corner) moments.push({ id: 'corner', label: PHASE_LABEL.FINAL_CORNER, text: cornerRank < startRank ? `${startRank}위에서 ${cornerRank}위로 올라섰습니다.` : cornerRank > startRank ? `${startRank}위에서 ${cornerRank}위로 밀려났습니다.` : `${cornerRank}위를 지키며 마지막 코너를 돌았습니다.` })
  if (stretch) moments.push({ id: 'stretch', label: PHASE_LABEL.STRETCH, text: stretchRank < cornerRank ? '진로를 확보하고 추격을 시작했습니다.' : stretchRank > cornerRank ? '직선에서 힘이 부쳐 순위가 내려갔습니다.' : '직선에서 순위를 지키며 승부를 이어 갔습니다.' })
  moments.push({ id: 'finish', label: PHASE_LABEL.FINISH, text: placing === 1 ? '1위로 결승선을 통과했습니다.' : `${placing}위로 결승선을 통과했습니다.` })
  return moments
}
