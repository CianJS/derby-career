'use client'

import { useMemo } from 'react'
import type { RaceFrame, RaceSimulationLog } from '@/lib/career/race-simulation'

const width = 600
const left = 28
const right = 12
const top = 12
const bottom = 20
const maxPoints = 160

type RankPoint = { tMs: number; ranks: Map<string, number> }

function rankSamples(log: RaceSimulationLog): RankPoint[] {
  const placing = new Map(log.finishOrder.map(record => [record.horseId, record]))
  return log.samples.map(sample => {
    const ordered = [...sample.runners].sort((a, b) => {
      const aRecord = placing.get(a.horseId)!
      const bRecord = placing.get(b.horseId)!
      const aDone = sample.tMs >= Math.round(aRecord.finishTime * 1000)
      const bDone = sample.tMs >= Math.round(bRecord.finishTime * 1000)
      if (aDone || bDone) return aDone && bDone ? aRecord.placing - bRecord.placing : aDone ? -1 : 1
      return b.distance - a.distance
    })
    return { tMs: sample.tMs, ranks: new Map(ordered.map((runner, index) => [runner.horseId, index + 1])) }
  })
}

export function PositionHistory({ log, frame, playerHorseId, names }: { log: RaceSimulationLog; frame: RaceFrame; playerHorseId: string; names: Map<string, string> }) {
  const ranked = useMemo(() => rankSamples(log), [log])
  const count = log.samples[0].runners.length
  const height = Math.max(150, count * 16 + top + bottom)
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const x = (tMs: number) => left + (tMs / log.durationMs) * plotWidth
  const y = (rank: number) => top + ((rank - 1) / Math.max(1, count - 1)) * plotHeight

  const visible = ranked.filter(point => point.tMs <= frame.tMs)
  const stride = Math.max(1, Math.ceil(visible.length / maxPoints))
  const points = visible.filter((_, index) => index % stride === 0 || index === visible.length - 1)
  const current: RankPoint = { tMs: frame.tMs, ranks: new Map(frame.runners.map(runner => [runner.horseId, runner.rank])) }
  if (!points.length || points[points.length - 1].tMs < current.tMs) points.push(current)

  const horseIds = log.samples[0].runners.map(runner => runner.horseId).filter(id => id !== playerHorseId)
  const line = (horseId: string) => points.map(point => `${x(point.tMs).toFixed(1)},${y(point.ranks.get(horseId)!).toFixed(1)}`).join(' ')
  const playerRank = current.ranks.get(playerHorseId)!
  const lastX = x(current.tMs)

  return <div className="race-ranking-panel">
    <div className="panel-title"><span>POSITION HISTORY</span><span>{names.get(playerHorseId)} 현재 {playerRank}위</span></div>
    <div className="px-3 py-3">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`전체 ${count}두의 순위 변화. ${names.get(playerHorseId)}은(는) 현재 ${playerRank}위입니다.`} className="block h-auto w-full">
        {Array.from({ length: count }, (_, index) => index + 1).map(rank => <g key={rank}>
          <line x1={left} x2={width - right} y1={y(rank)} y2={y(rank)} stroke="var(--border)" strokeWidth={1} opacity={0.55} />
          <text x={left - 8} y={y(rank)} textAnchor="end" dominantBaseline="central" fontSize={10} fill="var(--muted-foreground)">{rank}</text>
        </g>)}
        <line x1={lastX} x2={lastX} y1={top} y2={height - bottom} stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="2 3" opacity={0.5} />
        {horseIds.map(horseId => <polyline key={horseId} points={line(horseId)} fill="none" stroke="var(--muted-foreground)" strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" opacity={0.3} />)}
        <polyline points={line(playerHorseId)} fill="none" stroke="var(--primary)" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={lastX} cy={y(playerRank)} r={4} fill="var(--primary)" />
        <text x={left} y={height - 4} fontSize={9} fill="var(--muted-foreground)">START</text>
        <text x={width - right} y={height - 4} textAnchor="end" fontSize={9} fill="var(--muted-foreground)">FINISH</text>
      </svg>
    </div>
  </div>
}
