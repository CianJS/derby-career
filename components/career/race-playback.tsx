'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import type { RaceRunInput } from '@/lib/career/race-entry'
import { readRaceLog } from '@/lib/career/race-log-repository'
import { frameAt, highlightText, validateRaceLog, type RaceSimulationLog } from '@/lib/career/race-simulation'
import { useCareer } from '@/lib/career/store'

const phases = ['START', 'MID', 'FINAL_CORNER', 'STRETCH', 'FINISH'] as const
const speeds = [1, 2, 4] as const

function loadLog(run: RaceRunInput): { log: RaceSimulationLog | null; error: string | null } {
  try {
    const log = readRaceLog(run.raceRunId)
    if (!log) return { log: null, error: '저장된 경주 기록을 찾을 수 없습니다.' }
    validateRaceLog(log, run)
    return { log, error: null }
  } catch (cause) {
    return { log: null, error: cause instanceof Error ? cause.message : '경주 기록을 불러오지 못했습니다.' }
  }
}

export function RacePlayback({ onFinish, onBack }: { onFinish: () => void; onBack: () => void }) {
  const { ready, career } = useCareer()
  const run = career?.raceRun
  if (!ready) return <p role="status" className="py-8 text-sm">경주 기록을 불러오는 중…</p>
  if (!run) return <div className="py-8 text-sm"><p role="alert">진행 중인 출전 정보가 없습니다.</p><Button className="mt-4" variant="outline" onClick={onBack}>육성으로 돌아가기</Button></div>
  return <Playback key={run.raceRunId} run={run} onFinish={onFinish} onBack={onBack} />
}

function Playback({ run, onFinish, onBack }: { run: RaceRunInput; onFinish: () => void; onBack: () => void }) {
  const loaded = useMemo(() => loadLog(run), [run])
  if (!loaded.log) return <div className="py-8 text-sm"><p role="alert" className="ui-error-state">{loaded.error}</p><Button className="mt-4" variant="outline" onClick={onBack}>육성으로 돌아가기</Button></div>
  return <Stage run={run} log={loaded.log} onFinish={onFinish} />
}

function Stage({ run, log, onFinish }: { run: RaceRunInput; log: RaceSimulationLog; onFinish: () => void }) {
  const [time, setTime] = useState(0)
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState<1 | 2 | 4>(1)
  const timeRef = useRef(0)
  const pausedRef = useRef(false)
  const speedRef = useRef<1 | 2 | 4>(1)
  pausedRef.current = paused
  speedRef.current = speed

  useEffect(() => {
    let raf = 0
    let previous = performance.now()
    let lastHud = 0
    const tick = (now: number) => {
      const delta = Math.min(Math.max(0, now - previous), 250)
      previous = now
      if (!pausedRef.current && timeRef.current < log.durationMs) {
        timeRef.current = Math.min(log.durationMs, timeRef.current + delta * speedRef.current)
        if (now - lastHud >= 100 || timeRef.current >= log.durationMs) {
          lastHud = now
          setTime(timeRef.current)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [log.durationMs])

  const names = useMemo(() => new Map(run.runners.map(r => [r.horseSnapshot.id, r.horseSnapshot.name])), [run])
  const frame = frameAt(log, time)
  const finished = time >= log.durationMs
  const player = frame.runners.find(r => r.horseId === run.playerHorseId)!
  const phaseIndex = phases.indexOf(frame.phase)
  const highlight = log.highlights.filter(h => h.tMs <= time && highlightText(h)).at(-1)
  const jump = (next: number) => { timeRef.current = next; setTime(next) }
  const race = run.raceDefinitionSnapshot

  return <div className="mt-5">
    <header className="race-broadcast-header"><div><p className="ui-label text-muted-foreground">RACE VIEW · 저장된 경주 기록 재생</p><h1 className="ui-page-title mt-2 font-serif">{race.name}</h1><p className="mt-1 text-sm text-muted-foreground">{race.surface} {race.distance}m · {run.runners.length}두 출전 · {run.player.jockeySnapshot.name} · {run.player.tactic}</p></div></header>
    <div className="race-phase-strip" aria-label="경주 구간">{phases.map((p, i) => <span key={p} className={i === phaseIndex ? 'active' : ''}>{p.replace('_', ' ')}</span>)}</div>
    <main className="race-broadcast-stage">
      <div className="race-stage-top"><span className="ui-label text-primary">LIVE TRACK VIEW</span><span className="race-distance-live">{frame.remaining}m <small>REMAINING</small></span></div>
      <div className={`race-scene race-phase-${phaseIndex}`}>
        <div className="race-motion-lines" />
        <div className="race-track-grid" />
        <div className={`race-finish-band ${frame.remaining <= 400 ? 'is-near' : ''} ${frame.remaining <= 100 ? 'is-finish' : ''}`} />
        <div className="race-gate" />
        {frame.runners.map(r => {
          const isPlayer = r.horseId === run.playerHorseId
          return <div key={r.horseId} className={`race-broadcast-runner ${isPlayer ? 'player is-player' : 'rival'}`} style={{ '--runner-progress': `${(r.distance / log.raceDistance) * 100}%`, '--runner-lane': `${50 + r.lane}%` } as CSSProperties}><span className="runner-tag">{names.get(r.horseId)}{isPlayer && <em>YOU</em>}</span><i /></div>
        })}
        {highlight && <div className="race-event-pop" role="status"><span>{highlightText(highlight)}</span></div>}
      </div>
      <div className="race-stage-footer"><span>{frame.remaining}m remaining</span><div className="race-progress-bar"><i style={{ width: `${(time / log.durationMs) * 100}%` }} /></div><span>{frame.remaining <= 100 ? 'PHOTO FINISH' : frame.remaining <= 400 ? 'FINAL 400M' : ''}</span></div>
    </main>
    <section className="race-live-grid"><div className="race-ranking-panel"><div className="panel-title"><span>LIVE RANKING</span><span>{player.rank}위 / {frame.runners.length}두</span></div>{frame.runners.map(r => <div key={r.horseId} className={`race-rank-row ${r.horseId === run.playerHorseId ? 'player' : ''}`}><b>{r.rank}</b><span>{names.get(r.horseId)} {r.horseId === run.playerHorseId && <em>YOU</em>}</span><i><span style={{ width: `${Math.max(4, (r.distance / log.raceDistance) * 100)}%` }} /></i></div>)}</div></section>
    <footer className="race-control-deck">
      {finished ? <Button onClick={onFinish}>결과 확인</Button> : <Button onClick={() => setPaused(v => !v)}>{paused ? '계속' : '일시정지'}</Button>}
      <div className="race-speed-group" role="group" aria-label="재생 속도"><span className="ui-metadata">PLAYBACK</span>{speeds.map(value => <button key={value} type="button" aria-pressed={speed === value} className={speed === value ? 'active' : ''} onClick={() => { setSpeed(value); setPaused(false) }}>{value}x</button>)}</div>
      {!finished && <Button variant="outline" onClick={() => jump(log.durationMs)}>결과로 건너뛰기</Button>}
    </footer>
  </div>
}
