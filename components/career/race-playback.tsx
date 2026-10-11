'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { PositionHistory } from '@/components/career/race-position-history'
import type { RaceRunInput } from '@/lib/career/race-entry'
import { significantFeed } from '@/lib/career/race-feed'
import { readRaceLog } from '@/lib/career/race-log-repository'
import { frameAt, validateRaceLog, type RaceSimulationLog } from '@/lib/career/race-simulation'
import { useCareer } from '@/lib/career/store'

const phases = ['START', 'MID', 'FINAL_CORNER', 'STRETCH', 'FINISH'] as const
const STRIP_ROWS = 6

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

export function PhaseMarker({ phaseIndex }: { phaseIndex: number }) {
  return <ol className="race-phase-track" aria-label={`경주 구간, 현재 ${phases[phaseIndex].replace('_', ' ')}`}>
    {phases.map((phase, index) => <li key={phase} aria-current={index === phaseIndex ? 'step' : undefined} className={index === phaseIndex ? 'active' : index < phaseIndex ? 'passed' : ''}>{phase.replace('_', ' ')}</li>)}
  </ol>
}

export function RaceStrip({ frame, runners, playerHorseId, names, raceDistance }: { frame: ReturnType<typeof frameAt>; runners: RaceRunInput['runners']; playerHorseId: string; names: Map<string, string>; raceDistance: number }) {
  const gates = useMemo(() => new Map(runners.map((runner, index) => [runner.horseSnapshot.id, index + 1])), [runners])
  const ordered = [...frame.runners].sort((a, b) => (a.horseId === playerHorseId ? 1 : 0) - (b.horseId === playerHorseId ? 1 : 0))
  return <div className="race-strip" role="img" aria-label={`레이스 스트립. 결승까지 ${frame.remaining}미터 남았습니다.`}>
    <div className="race-strip-lanes" />
    <span className="race-strip-start" />
    <span className="race-strip-finish" />
    {ordered.map(runner => {
      const gate = gates.get(runner.horseId) ?? 0
      const isPlayer = runner.horseId === playerHorseId
      const row = (gate - 1) % STRIP_ROWS
      const progress = Math.min(100, Math.max(0, (runner.distance / raceDistance) * 100))
      return <div key={runner.horseId} className={`race-strip-runner ${isPlayer ? 'is-player' : ''}`} style={{ '--strip-x': progress / 100, '--strip-row': row } as CSSProperties}>
        <b>{gate}</b>
        {isPlayer && <span>{names.get(runner.horseId)} · YOU</span>}
      </div>
    })}
  </div>
}

export function PositionBoard({ frame, playerHorseId, names, raceDistance }: { frame: ReturnType<typeof frameAt>; playerHorseId: string; names: Map<string, string>; raceDistance: number }) {
  const player = frame.runners.find(runner => runner.horseId === playerHorseId)
  return <div className="race-ranking-panel">
    <div className="panel-title"><span>POSITION BOARD</span><span>{player?.rank}위 / {frame.runners.length}두</span></div>
    <ol className="race-board">
      {frame.runners.map(runner => {
        const isPlayer = runner.horseId === playerHorseId
        return <li key={runner.horseId} className={isPlayer ? 'player' : ''}>
          <b>{runner.rank}</b>
          <span>{names.get(runner.horseId)}</span>
          {isPlayer ? <em>YOU</em> : <i />}
          <u><s style={{ width: `${Math.max(4, (runner.distance / raceDistance) * 100)}%` }} /></u>
        </li>
      })}
    </ol>
  </div>
}

function Stage({ run, log, onFinish }: { run: RaceRunInput; log: RaceSimulationLog; onFinish: () => void }) {
  const [time, setTime] = useState(0)
  const [paused, setPaused] = useState(false)
  const timeRef = useRef(0)
  const pausedRef = useRef(false)
  pausedRef.current = paused

  useEffect(() => {
    let raf = 0
    let previous = performance.now()
    let lastHud = 0
    const tick = (now: number) => {
      const delta = Math.min(Math.max(0, now - previous), 250)
      previous = now
      if (!pausedRef.current && timeRef.current < log.durationMs) {
        timeRef.current = Math.min(log.durationMs, timeRef.current + delta)
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
  const phaseIndex = phases.indexOf(frame.phase)
  const feed = useMemo(() => significantFeed(log, names, Math.floor(time / 500) * 500), [log, names, time])
  const race = run.raceDefinitionSnapshot

  return <div className="mt-4">
    <header className="race-broadcast-header">
      <div>
        <h1 className="ui-page-title font-serif">{race.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{race.surface} {race.distance}m · {run.runners.length}두 · {run.player.jockeySnapshot.name} · {run.player.tactic} · 남은 거리 {frame.remaining}m</p>
      </div>
      {finished ? <Button onClick={onFinish}>결과 확인</Button> : <Button variant="outline" onClick={() => setPaused(v => !v)}>{paused ? '계속' : '일시정지'}</Button>}
    </header>
    <PhaseMarker phaseIndex={phaseIndex} />
    <RaceStrip frame={frame} runners={run.runners} playerHorseId={run.playerHorseId} names={names} raceDistance={log.raceDistance} />
    <section className="race-live-grid">
      <PositionBoard frame={frame} playerHorseId={run.playerHorseId} names={names} raceDistance={log.raceDistance} />
      <div className="flex min-w-0 flex-col gap-3">
        <PositionHistory log={log} frame={frame} playerHorseId={run.playerHorseId} names={names} />
        <div className="race-ranking-panel">
          <div className="panel-title"><span>주요 상황</span></div>
          {feed.length ? <ul aria-label="주요 상황">{feed.map(item => <li key={item.id} className="flex gap-3 border-b border-border px-3 py-1.5 text-xs leading-5 last:border-b-0"><span className="w-12 shrink-0 tabular-nums text-muted-foreground">{(item.tMs / 1000).toFixed(1)}s</span><span>{item.text}</span></li>)}</ul> : <p className="px-3 py-2 text-xs text-muted-foreground">경주가 진행되면 주요 상황이 표시됩니다.</p>}
        </div>
      </div>
    </section>
  </div>
}
