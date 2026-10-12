import { LOOKBACK_MS, analyzeRace } from './race-spectate'
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

const COMMENTARY_BUCKET_MS = 5000
const PHASE_ENTRY_MS = 3500

/** 받침 유무에 따라 조사를 고른다. */
function withParticle(name: string, withFinal: string, withoutFinal: string): string {
  const code = name.charCodeAt(name.length - 1) - 0xac00
  const hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0
  return `${name}${hasFinal ? withFinal : withoutFinal}`
}
const subject = (name: string) => withParticle(name, '이', '가')
const withName = (name: string) => withParticle(name, '과', '와')

function pick(options: string[], tMs: number): string {
  return options[Math.floor(tMs / COMMENTARY_BUCKET_MS) % options.length]
}

/**
 * 현재 재생 시점의 상황을 설명하는 한 문장. 사전 작성된 템플릿만 사용하고,
 * 재생 시점 이전의 저장된 위치·순위·이벤트로만 문장을 고른다.
 * 같은 상황이 이어지면 5초 단위로 다른 표현을 돌려 쓴다.
 */
export function liveCommentary(log: RaceSimulationLog, tMs: number, playerHorseId: string, names: Map<string, string>): string {
  const a = analyzeRace(log, tMs, playerHorseId)
  const me = names.get(playerHorseId) ?? '출전마'
  const { now } = a
  const nameOf = (id: string) => names.get(id) ?? '앞선 말'
  if (now.finished) return `${subject(me)} 결승선을 통과했습니다.`
  if ((a.phase === 'FINAL_CORNER' || a.phase === 'STRETCH') && a.phaseAgeMs <= PHASE_ENTRY_MS) return a.phase === 'STRETCH' ? '마지막 직선에 진입했습니다.' : '마지막 코너에 진입했습니다.'
  if (a.recentEvent) {
    const type = a.recentEvent.type
    if (type === 'BLOCKED') return `${subject(me)} 앞길이 막혀 속도를 올리지 못하고 있습니다.`
    if (type === 'PATH_CLEAR') return `${subject(me)} 진로를 확보했습니다.`
    if (type === 'SPRINT_START') return `${subject(me)} 스퍼트를 시작했습니다.`
    if (type === 'OVERTAKE') return `${subject(me)} ${now.rank}위로 올라섰습니다.`
  }
  if (a.leaderChanged && now.rank === 1) return `${subject(me)} 선두로 나섰습니다.`
  if (a.rankDelta > 0) return pick([`${subject(me)} ${a.previousRank}위에서 ${now.rank}위로 올라섰습니다.`, `순위를 ${now.rank}위까지 끌어올렸습니다.`], tMs)
  if (a.rankDelta < 0) return pick([`${a.previousRank}위에서 ${now.rank}위로 밀려났습니다.`, `${subject(me)} ${now.rank}위로 내려앉았습니다.`], tMs)
  if (now.rank === 1) {
    if (a.behindTrend !== null && a.behindTrend >= 1) return pick(['2위와의 격차가 줄어들고 있습니다.', '뒤에서 추격이 이어지고 있습니다.'], tMs)
    if (a.behindTrend !== null && a.behindTrend <= -1) return pick(['2위와의 격차를 벌리고 있습니다.', '뒤쪽과의 간격이 벌어지고 있습니다.'], tMs)
    return pick([`${subject(me)} 선두를 유지하고 있습니다.`, '선두 자리를 지키며 달리고 있습니다.'], tMs)
  }
  if (now.ahead && a.aheadTrend !== null && a.aheadTrend >= 1) return pick([`${withName(nameOf(now.ahead.horseId))}의 거리를 좁히고 있습니다.`, '앞선 말과의 간격이 줄어들고 있습니다.'], tMs)
  if (now.behind && a.behindTrend !== null && a.behindTrend >= 1) return pick([`뒤에서 ${subject(nameOf(now.behind.horseId))} 따라붙고 있습니다.`, '뒤쪽 말이 간격을 좁히고 있습니다.'], tMs)
  if (now.ahead && a.aheadTrend !== null && a.aheadTrend <= -1) return pick([`앞선 ${withName(nameOf(now.ahead.horseId))}의 거리가 벌어지고 있습니다.`, '앞선 말과의 간격이 벌어지고 있습니다.'], tMs)
  if (a.tMs < LOOKBACK_MS) return '출발 직후, 각 말이 자리를 잡고 있습니다.'
  if (!now.behind) return pick(['최후미에서 레이스를 이어 가고 있습니다.', '마지막 순위에서 흐름을 살피고 있습니다.'], tMs)
  return pick([`${now.rank}위에서 흐름을 이어 가고 있습니다.`, `${now.rank}위 자리에서 레이스를 풀어 가고 있습니다.`], tMs)
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
