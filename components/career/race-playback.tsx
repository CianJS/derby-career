'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PositionHistory } from '@/components/career/race-position-history'
import type { RaceRunInput } from '@/lib/career/race-entry'
import { buildFeedTimeline, feedAt, liveCommentary } from '@/lib/career/race-feed'
import { useRaceData } from '@/lib/career/use-race-data'
import { type RaceFrame, type RaceSimulationLog } from '@/lib/career/race-simulation'
import {
  AUTO_SPEEDS,
  analyzeRace,
  desiredAutoSpeed,
  initialAuto,
  momentOf,
  spreadMarkers,
  stepAuto,
  stripHeightRem,
  stripLayout,
  type AutoSpeed,
  type Moment,
  type PlayerSituation,
} from '@/lib/career/race-spectate'
import { useCareer } from '@/lib/career/store'

const phases = ['START', 'MID', 'FINAL_CORNER', 'STRETCH', 'FINISH'] as const
const phaseLabels = ['출발', '중반', '마지막 코너', '최종 직선', '결승'] as const
const GAP_SCALES = [10, 20, 40, 80]
type SpeedMode = 'AUTO' | AutoSpeed

export function RacePlayback({ onFinish, onBack }: { onFinish: () => void; onBack: () => void }) {
  const { ready, career } = useCareer()
  const run = career?.raceRun
  if (!ready) {
    return (
      <p role="status" className="py-8 text-sm">
        경주 기록을 불러오는 중…
      </p>
    )
  }
  if (!run) {
    return (
      <div className="py-8 text-sm">
        <p role="alert">진행 중인 출전 정보가 없습니다.</p>
        <Button className="mt-4" variant="outline" onClick={onBack}>
          육성으로 돌아가기
        </Button>
      </div>
    )
  }
  return <Playback key={run.raceRunId} onFinish={onFinish} onBack={onBack} />
}

function Playback({ onFinish, onBack }: { onFinish: () => void; onBack: () => void }) {
  const loaded = useRaceData()
  if (!loaded.data) {
    return (
      <div className="py-8 text-sm">
        <p
          role={loaded.error ? 'alert' : 'status'}
          className={loaded.error ? 'ui-error-state' : undefined}
        >
          {loaded.error ?? '경주 기록을 불러오는 중…'}
        </p>
        {loaded.error && (
          <Button className="mt-4" variant="outline" onClick={loaded.retry}>
            기록 다시 불러오기
          </Button>
        )}
        <Button className="mt-4" variant="outline" onClick={onBack}>
          육성으로 돌아가기
        </Button>
      </div>
    )
  }
  return <Stage run={loaded.data.run} log={loaded.data.log} onFinish={onFinish} />
}

export function PhaseMarker({ phaseIndex }: { phaseIndex: number }) {
  return (
    <ol className="race-phase-track" aria-label={`경주 구간, 현재 ${phaseLabels[phaseIndex]}`}>
      {phases.map((phase, index) => (
        <li
          key={phase}
          aria-current={index === phaseIndex ? 'step' : undefined}
          className={index === phaseIndex ? 'active' : index < phaseIndex ? 'passed' : ''}
        >
          <span className="race-phase-label">{phaseLabels[index]}</span>
        </li>
      ))}
    </ol>
  )
}

export function RaceStrip({
  frame,
  runners,
  playerHorseId,
  names,
  raceDistance,
  situation,
}: {
  frame: RaceFrame
  runners: RaceRunInput['runners']
  playerHorseId: string
  names: Map<string, string>
  raceDistance: number
  situation: PlayerSituation
}) {
  const gates = useMemo(
    () => new Map(runners.map((runner, index) => [runner.horseSnapshot.id, index + 1])),
    [runners],
  )
  // Only vertical label separation adapts to the viewport. Saved distance anchors never move.
  const stripRef = useRef<HTMLDivElement>(null)
  const [minDx, setMinDx] = useState(0.5)
  useEffect(() => {
    const element = stripRef.current
    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      const rem = parseFloat(getComputedStyle(element).fontSize)
      setMinDx(Math.min(1, (7 * rem) / Math.max(1, entry.contentRect.width - 3 * rem)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const heightRem = Math.max(stripHeightRem(runners.length), runners.length * 1.85)
  const layout = stripLayout(frame, raceDistance, playerHorseId, gates, minDx, 1.55 / heightRem)
  const rows = Math.min(9, Math.ceil(runners.length / 2))
  const ordered = [...frame.runners].sort(
    (a, b) => (a.horseId === playerHorseId ? 1 : 0) - (b.horseId === playerHorseId ? 1 : 0),
  )
  return (
    <div
      ref={stripRef}
      className="race-strip"
      role="img"
      aria-label={`레이스 스트립. 가로는 주행 거리, 세로는 겹침을 조정한 진로이며 순위 행이 아닙니다. 선두 남은 거리 ${frame.remaining}미터. 내 말 ${names.get(playerHorseId)}, 마번 ${gates.get(playerHorseId)}, 현재 ${situation.rank}위, 내 말 남은 거리 ${situation.remaining}미터.`}
      data-frame-ms={frame.tMs}
      style={{ '--strip-rows': rows, '--strip-h': `${heightRem}rem` } as CSSProperties}
    >
      <div className="race-strip-lanes" />
      <span className="race-strip-start" />
      <span className="race-strip-finish" />
      {ordered.map((runner) => {
        const gate = gates.get(runner.horseId) ?? 0
        const spot = layout.get(runner.horseId)!
        const isPlayer = runner.horseId === playerHorseId
        const role = isPlayer
          ? 'is-player'
          : runner.horseId === situation.ahead?.horseId
            ? 'is-ahead'
            : runner.horseId === situation.behind?.horseId
              ? 'is-behind'
              : ''
        return (
          <div
            key={runner.horseId}
            className={`race-strip-runner ${role} ${spot.x > 0.75 ? 'label-left' : ''}`}
            data-horse-id={runner.horseId}
            data-gate={gate}
            data-rank={runner.rank}
            data-distance={runner.distance}
            title={`마번 ${gate} · ${names.get(runner.horseId)} · 현재 ${runner.rank}위`}
            style={{ '--strip-x': spot.x, '--strip-y': spot.y } as CSSProperties}
          >
            <b>{gate}</b>
            {isPlayer && <span>내 말</span>}
            {role === 'is-ahead' && <small>앞</small>}
            {role === 'is-behind' && <small>뒤</small>}
          </div>
        )
      })}
    </div>
  )
}

export function GapLane({
  frame,
  situation,
  playerHorseId,
  gates,
}: {
  frame: RaceFrame
  situation: PlayerSituation
  playerHorseId: string
  gates: Map<string, number>
}) {
  const me = frame.runners.find((runner) => runner.horseId === playerHorseId)!
  const widest = Math.max(situation.ahead?.gap ?? 0, situation.behind?.gap ?? 0)
  const span =
    GAP_SCALES.find((scale) => scale >= widest * 1.15) ?? GAP_SCALES[GAP_SCALES.length - 1]
  const others = frame.runners.filter(
    (runner) =>
      (runner.horseId === situation.ahead?.horseId ||
        runner.horseId === situation.behind?.horseId) &&
      Math.abs(runner.distance - me.distance) <= span,
  )
  const items = [
    { id: playerHorseId, x: 0.5, y: 0.5 },
    ...others.map((runner) => ({
      id: runner.horseId,
      x: 0.5 + (runner.distance - me.distance) / span / 2,
      y: 0.5 + (runner.lane - me.lane) / 160,
    })),
  ]
  const ys = spreadMarkers(items, 0.05, 0.3, 0.17, 0.83)
  return (
    <div
      className="race-gap-lane"
      role="img"
      data-frame-ms={frame.tMs}
      aria-label={`내 말과 바로 앞·뒤 말만 표시, 앞뒤 ±${span}미터 범위. 숫자는 마번, 사각형은 내 말입니다. 왼쪽은 뒤, 오른쪽은 앞입니다.`}
    >
      <span className="race-gap-axis" />
      <span className="race-gap-scale left">뒤 {span}m</span>
      <span className="race-gap-scale right">앞 {span}m</span>
      {items.map((item) => {
        const isPlayer = item.id === playerHorseId
        const role = isPlayer
          ? 'is-player'
          : item.id === situation.ahead?.horseId
            ? 'is-ahead'
            : item.id === situation.behind?.horseId
              ? 'is-behind'
              : ''
        return (
          <i
            key={item.id}
            className={`race-gap-dot ${role}`}
            data-horse-id={item.id}
            data-gate={gates.get(item.id)}
            data-rank={frame.runners.find((runner) => runner.horseId === item.id)!.rank}
            title={`마번 ${gates.get(item.id)} · 현재 ${frame.runners.find((runner) => runner.horseId === item.id)!.rank}위`}
            style={{ left: `${item.x * 100}%`, top: `${ys.get(item.id)! * 100}%` }}
          >
            {gates.get(item.id)}
          </i>
        )
      })}
    </div>
  )
}

export function RaceFocus({
  frame,
  situation,
  moment,
  commentary,
  speedLabel,
  names,
  playerHorseId,
  gates,
}: {
  frame: RaceFrame
  situation: PlayerSituation
  moment: Moment | null
  commentary: string
  speedLabel: string
  names: Map<string, string>
  playerHorseId: string
  gates: Map<string, number>
}) {
  const nameOf = (id: string) => names.get(id) ?? ''
  return (
    <aside
      className={`race-focus ${moment ? 'has-moment' : ''}`}
      aria-label="내 말 현황"
      data-frame-ms={frame.tMs}
      data-rank={situation.rank}
      data-remaining={situation.remaining}
    >
      <div className="race-focus-head">
        <span>내 말 현황</span>
        <span className="race-focus-speed">{speedLabel}</span>
      </div>
      <p className="race-focus-identity">
        <strong>{nameOf(playerHorseId)}</strong>
        <span>마번 {gates.get(playerHorseId)} · 출발 번호</span>
      </p>
      <div className="race-focus-main">
        <p className="race-focus-rank">
          <span className="race-rank-caption">현재 순위</span>
          <strong>{situation.rank}</strong>위<small> / {situation.total}두</small>
        </p>
        <p className="race-focus-remaining">
          <span>내 말 남은 거리</span>
          <b>{situation.remaining}m</b>
        </p>
      </div>
      <p className="race-focus-moment">{moment ? moment.label : '\u00a0'}</p>
      <dl className="race-focus-gaps">
        <div>
          <dt>앞</dt>
          <dd>
            {situation.finished
              ? '결승 통과'
              : situation.ahead
                ? `마번 ${gates.get(situation.ahead.horseId)} · ${nameOf(situation.ahead.horseId)} · ${situation.ahead.gap.toFixed(1)}m 앞`
                : situation.rank === 1
                  ? '선두'
                  : '앞선 말 결승 통과'}
          </dd>
        </div>
        <div>
          <dt>뒤</dt>
          <dd>
            {situation.finished
              ? '결승 통과'
              : situation.behind
                ? `마번 ${gates.get(situation.behind.horseId)} · ${nameOf(situation.behind.horseId)} · ${situation.behind.gap.toFixed(1)}m 뒤`
                : situation.rank === situation.total
                  ? '최후미'
                  : '뒤 말 정보 없음'}
          </dd>
        </div>
      </dl>
      <p className="race-focus-leader">
        {situation.finished
          ? '내 말 결승 통과'
          : situation.rank === 1
            ? '현재 선두'
            : frame.runners[0].finished
              ? '선두 결승 통과'
              : `선두와 ${Math.max(0, frame.runners[0].distance - frame.runners.find((runner) => runner.horseId === playerHorseId)!.distance).toFixed(1)}m 차이`}
      </p>
      <p className="race-focus-commentary">
        <b>실시간 중계</b>
        {commentary}
      </p>
      <GapLane frame={frame} situation={situation} playerHorseId={playerHorseId} gates={gates} />
      <p className="race-gap-caption">내 말과 바로 앞·뒤 말 확대 · 숫자: 마번 · 사각형: 내 말</p>
    </aside>
  )
}

export function PositionBoard({
  frame,
  playerHorseId,
  names,
  raceDistance,
  gates,
}: {
  frame: RaceFrame
  playerHorseId: string
  names: Map<string, string>
  raceDistance: number
  gates: Map<string, number>
}) {
  const player = frame.runners.find((runner) => runner.horseId === playerHorseId)
  return (
    <div className="race-ranking-panel" data-frame-ms={frame.tMs}>
      <div className="panel-title">
        <span>현재 순위</span>
        <span>
          {player?.rank}위 / {frame.runners.length}두
        </span>
      </div>
      <p className="race-board-guide">현재 순위 순 · 마번은 출발 번호입니다.</p>
      <ol
        aria-label="현재 순위 순으로 정렬한 출전마"
        className={`race-board ${frame.runners.length > 12 ? 'is-dense' : ''}`}
      >
        {[...frame.runners]
          .sort((a, b) => a.rank - b.rank)
          .map((runner) => {
            const isPlayer = runner.horseId === playerHorseId
            return (
              <li
                key={runner.horseId}
                className={isPlayer ? 'player' : ''}
                data-horse-id={runner.horseId}
                data-rank={runner.rank}
                data-distance={runner.distance}
                data-gate={gates.get(runner.horseId)}
              >
                <b>{runner.rank}위</b>
                <span>
                  <small>마번 {gates.get(runner.horseId)}</small>
                  {names.get(runner.horseId)}
                  {isPlayer && <em>내 말</em>}
                </span>
                <u>
                  <s style={{ width: `${Math.max(4, (runner.distance / raceDistance) * 100)}%` }} />
                </u>
              </li>
            )
          })}
      </ol>
    </div>
  )
}

export function Stage({
  run,
  log,
  onFinish,
}: {
  run: RaceRunInput
  log: RaceSimulationLog
  onFinish: () => void
}) {
  const [time, setTime] = useState(0)
  const [paused, setPaused] = useState(false)
  const [mode, setMode] = useState<SpeedMode>('AUTO')
  const [effectiveSpeed, setEffectiveSpeed] = useState<AutoSpeed>(4)
  const timeRef = useRef(0)
  const pausedRef = useRef(false)
  const modeRef = useRef<SpeedMode>('AUTO')
  const speedRef = useRef<AutoSpeed>(4)
  const autoRef = useRef(initialAuto(0))
  pausedRef.current = paused

  useEffect(() => {
    let raf = 0
    let previous = performance.now()
    let lastHud = 0
    autoRef.current = initialAuto(previous)
    const tick = (now: number) => {
      const delta = Math.min(Math.max(0, now - previous), 250)
      previous = now
      if (!pausedRef.current && timeRef.current < log.durationMs) {
        timeRef.current = Math.min(log.durationMs, timeRef.current + delta * speedRef.current)
        if (now - lastHud >= 100 || timeRef.current >= log.durationMs) {
          lastHud = now
          if (modeRef.current === 'AUTO') {
            const next = stepAuto(
              autoRef.current,
              desiredAutoSpeed(analyzeRace(log, timeRef.current, run.playerHorseId)),
              now,
            )
            autoRef.current = next
            if (next.speed !== speedRef.current) {
              speedRef.current = next.speed
              setEffectiveSpeed(next.speed)
            }
          }
          setTime(timeRef.current)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [log, run.playerHorseId])

  function chooseMode(next: SpeedMode) {
    modeRef.current = next
    setMode(next)
    if (next === 'AUTO') {
      autoRef.current = initialAuto(performance.now(), speedRef.current)
    } else {
      speedRef.current = next
      setEffectiveSpeed(next)
    }
  }

  const names = useMemo(
    () => new Map(run.runners.map((r) => [r.horseSnapshot.id, r.horseSnapshot.name])),
    [run],
  )
  const gates = useMemo(
    () => new Map(run.runners.map((runner, index) => [runner.horseSnapshot.id, index + 1])),
    [run],
  )
  const analysis = useMemo(
    () => analyzeRace(log, time, run.playerHorseId),
    [log, time, run.playerHorseId],
  )
  const { frame, now: situation } = analysis
  const moment = momentOf(analysis)
  const finished = time >= log.durationMs
  const phaseIndex = phases.indexOf(frame.phase)
  const commentary = useMemo(
    () => liveCommentary(log, frame.tMs, run.playerHorseId, names),
    [log, frame.tMs, run.playerHorseId, names],
  )
  const feedTimeline = useMemo(() => buildFeedTimeline(log, names), [log, names])
  const feed = useMemo(() => feedAt(feedTimeline, frame.tMs), [feedTimeline, frame.tMs])
  const race = run.raceDefinitionSnapshot
  const speedLabel = mode === 'AUTO' ? `자동 · x${effectiveSpeed}` : `x${effectiveSpeed}`

  return (
    <div className="lab-playback mt-3" data-frame-ms={frame.tMs}>
      <header className="race-broadcast-header">
        <div>
          <h1 className="ui-page-title font-serif">{race.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {race.surface === 'Turf' ? '잔디' : race.surface} {race.distance}m ·{' '}
            {run.runners.length}두 · {run.player.jockeySnapshot.name} · {run.player.tactic} · 선두
            남은 거리 <span data-leader-remaining={frame.remaining}>{frame.remaining}m</span>
          </p>
        </div>
      </header>
      <div className="race-spectate-guide">
        <PhaseMarker phaseIndex={phaseIndex} />
        <p className="race-strip-guide">
          <span>
            숫자는 마번(출발 번호)입니다. 사각형·내 말 / 실선·앞말 / 점선·뒷말로 구별합니다. 현재
            순위는 내 말 현황과 현재 순위에서 확인하세요.
          </span>
          <span>
            가로는 주행 거리(오른쪽이 결승선), 세로는 진로를 바탕으로 겹침을 조정한 위치이며 고정
            차선이나 순위 행이 아닙니다.
          </span>
        </p>
      </div>
      <div className="race-stage-row">
        <RaceStrip
          frame={frame}
          runners={run.runners}
          playerHorseId={run.playerHorseId}
          names={names}
          raceDistance={log.raceDistance}
          situation={situation}
        />
        <RaceFocus
          frame={frame}
          situation={situation}
          moment={moment}
          commentary={commentary}
          speedLabel={speedLabel}
          names={names}
          playerHorseId={run.playerHorseId}
          gates={gates}
        />
      </div>
      <section className="race-live-grid">
        <PositionBoard
          frame={frame}
          playerHorseId={run.playerHorseId}
          names={names}
          raceDistance={log.raceDistance}
          gates={gates}
        />
        <PositionHistory log={log} frame={frame} playerHorseId={run.playerHorseId} names={names} />
      </section>
      <section className="race-ranking-panel mt-3" data-frame-ms={frame.tMs}>
        <div className="panel-title">
          <span>주요 상황</span>
        </div>
        {feed.length ? (
          <ul aria-label="주요 상황" className="race-feed-list">
            {feed.map((item) => (
              <li key={item.id}>
                <span>{(item.tMs / 1000).toFixed(1)}초</span>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            경주가 진행되면 주요 상황이 표시됩니다.
          </p>
        )}
      </section>
      <div className="race-playback-controls" role="group" aria-label="경주 재생 조작">
        {finished ? (
          <Button onClick={onFinish}>결과 확인</Button>
        ) : (
          <>
            <div role="group" aria-label="재생 배속" className="flex items-center gap-1">
              <Button
                size="sm"
                variant={mode === 'AUTO' ? 'default' : 'outline'}
                aria-pressed={mode === 'AUTO'}
                onClick={() => chooseMode('AUTO')}
              >
                자동
              </Button>
              {AUTO_SPEEDS.map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={mode === value ? 'default' : 'outline'}
                  aria-pressed={mode === value}
                  onClick={() => chooseMode(value)}
                >
                  x{value}
                </Button>
              ))}
            </div>
            <Button variant="outline" onClick={() => setPaused((v) => !v)}>
              {paused ? '계속' : '일시정지'}
            </Button>
            <Button
              variant="outline"
              onClick={onFinish}
              aria-label="경주 연출을 건너뛰고 결과 보기"
            >
              <SkipForward data-icon="inline-start" aria-hidden />
              건너뛰기
            </Button>
          </>
        )}
      </div>
      <RaceAnnouncement
        summary={`${phaseLabels[phaseIndex]} · ${situation.finished ? '내 말 결승 통과' : (moment?.label ?? '경주 진행 중')}`}
      />
    </div>
  )
}

/** Announce a short situation at most once per three seconds, never every HUD frame. */
function RaceAnnouncement({ summary }: { summary: string }) {
  const latest = useRef(summary)
  latest.current = summary
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    const timer = window.setInterval(() => setAnnouncement(latest.current), 3000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </p>
  )
}
