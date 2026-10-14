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
  STRIP_MARKER_DX,
  STRIP_MARKER_REM,
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
    <ol
      className="race-phase-track"
      aria-label={`경주 구간, 현재 ${phases[phaseIndex].replace('_', ' ')}`}
    >
      {phases.map((phase, index) => (
        <li
          key={phase}
          aria-current={index === phaseIndex ? 'step' : undefined}
          className={index === phaseIndex ? 'active' : index < phaseIndex ? 'passed' : ''}
        >
          {phase.replace('_', ' ')}
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
  const heightRem = stripHeightRem(runners.length)
  const layout = stripLayout(
    frame,
    raceDistance,
    playerHorseId,
    gates,
    STRIP_MARKER_DX,
    STRIP_MARKER_REM / heightRem,
  )
  const rows = Math.min(9, Math.ceil(runners.length / 2))
  const ordered = [...frame.runners].sort(
    (a, b) => (a.horseId === playerHorseId ? 1 : 0) - (b.horseId === playerHorseId ? 1 : 0),
  )
  return (
    <div
      className="race-strip"
      role="img"
      aria-label={`레이스 스트립. 결승까지 ${frame.remaining}미터 남았습니다.`}
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
            className={`race-strip-runner ${role}`}
            style={{ '--strip-x': spot.x, '--strip-y': spot.y } as CSSProperties}
          >
            <b>{gate}</b>
            {isPlayer && <span>{names.get(runner.horseId)} · YOU</span>}
            {role === 'is-ahead' && <small>앞 · {names.get(runner.horseId)}</small>}
            {role === 'is-behind' && <small>뒤 · {names.get(runner.horseId)}</small>}
          </div>
        )
      })}
    </div>
  )
}

function GapLane({
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
    (runner) => runner.horseId !== playerHorseId && Math.abs(runner.distance - me.distance) <= span,
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
    <div className="race-gap-lane" role="img" aria-label={`내 말 기준 앞뒤 ±${span}미터 범위`}>
      <span className="race-gap-axis" />
      <span className="race-gap-scale left">-{span}m</span>
      <span className="race-gap-scale right">+{span}m</span>
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
            style={{ left: `${item.x * 100}%`, top: `${ys.get(item.id)! * 100}%` }}
          >
            {gates.get(item.id)}
          </i>
        )
      })}
    </div>
  )
}

function RaceFocus({
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
    <aside className={`race-focus ${moment ? 'has-moment' : ''}`} aria-label="내 말 현황">
      <div className="race-focus-head">
        <span>FOCUS</span>
        <span className="race-focus-speed">{speedLabel}</span>
      </div>
      <div className="race-focus-main">
        <p className="race-focus-rank">
          <strong>{situation.rank}</strong>위<small> / {situation.total}두</small>
        </p>
        <p className="race-focus-remaining">
          <span>남은 거리</span>
          <b>{situation.remaining}m</b>
        </p>
      </div>
      <p className="race-focus-moment" aria-live="polite">
        {moment ? moment.label : '\u00a0'}
      </p>
      <dl className="race-focus-gaps">
        <div>
          <dt>앞</dt>
          <dd>
            {situation.finished
              ? '-'
              : situation.ahead
                ? `${nameOf(situation.ahead.horseId)} +${situation.ahead.gap.toFixed(1)}m`
                : situation.rank === 1
                  ? '선두'
                  : '-'}
          </dd>
        </div>
        <div>
          <dt>뒤</dt>
          <dd>
            {situation.finished
              ? '-'
              : situation.behind
                ? `${nameOf(situation.behind.horseId)} -${situation.behind.gap.toFixed(1)}m`
                : '최후미'}
          </dd>
        </div>
      </dl>
      <GapLane frame={frame} situation={situation} playerHorseId={playerHorseId} gates={gates} />
      <p className="race-focus-commentary" aria-live="polite">
        {commentary}
      </p>
    </aside>
  )
}

export function PositionBoard({
  frame,
  playerHorseId,
  names,
  raceDistance,
}: {
  frame: RaceFrame
  playerHorseId: string
  names: Map<string, string>
  raceDistance: number
}) {
  const player = frame.runners.find((runner) => runner.horseId === playerHorseId)
  return (
    <div className="race-ranking-panel">
      <div className="panel-title">
        <span>POSITION BOARD</span>
        <span>
          {player?.rank}위 / {frame.runners.length}두
        </span>
      </div>
      <ol className={`race-board ${frame.runners.length > 12 ? 'is-dense' : ''}`}>
        {frame.runners.map((runner) => {
          const isPlayer = runner.horseId === playerHorseId
          return (
            <li key={runner.horseId} className={isPlayer ? 'player' : ''}>
              <b>{runner.rank}</b>
              <span>{names.get(runner.horseId)}</span>
              {isPlayer ? <em>YOU</em> : <i />}
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

function Stage({
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
  const secondBucket = Math.floor(time / 1000) * 1000
  const commentary = useMemo(
    () => liveCommentary(log, secondBucket, run.playerHorseId, names),
    [log, secondBucket, run.playerHorseId, names],
  )
  const feedTimeline = useMemo(() => buildFeedTimeline(log, names), [log, names])
  const feedBucket = Math.floor(time / 500) * 500
  const feed = useMemo(() => feedAt(feedTimeline, feedBucket), [feedTimeline, feedBucket])
  const race = run.raceDefinitionSnapshot
  const speedLabel = mode === 'AUTO' ? `AUTO · x${effectiveSpeed}` : `x${effectiveSpeed}`

  return (
    <div className="lab-playback mt-3">
      <header className="race-broadcast-header">
        <div>
          <h1 className="ui-page-title font-serif">{race.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {race.surface} {race.distance}m · {run.runners.length}두 ·{' '}
            {run.player.jockeySnapshot.name} · {run.player.tactic} · 남은 거리 {frame.remaining}m
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
                  AUTO
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
      </header>
      <PhaseMarker phaseIndex={phaseIndex} />
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
        />
        <PositionHistory log={log} frame={frame} playerHorseId={run.playerHorseId} names={names} />
      </section>
      <section className="race-ranking-panel mt-3">
        <div className="panel-title">
          <span>주요 상황</span>
        </div>
        {feed.length ? (
          <ul aria-label="주요 상황" className="race-feed-list">
            {feed.map((item) => (
              <li key={item.id}>
                <span>{(item.tMs / 1000).toFixed(1)}s</span>
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
    </div>
  )
}
