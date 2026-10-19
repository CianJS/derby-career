/**
 * Local race-engine balance audit. Not part of the app bundle.
 *
 *   pnpm dlx tsx scripts/race-audit.ts [engineVersion] [--field=v1] [--json out.json]
 *
 * 3 fixture horses x 3 distances x 4 tactics x 12 fixed seeds = 432 runs. Everything is deterministic: the same
 * engine version always prints the same table. Nothing here changes game data.
 */
import { writeFileSync } from 'node:fs'
import { horses, startCareer } from '../lib/career/model'
import { contractedJockeys, createRaceRun, raceDefinitions, tactics, type RaceRunInput } from '../lib/career/race-entry'
import { legacyFieldV1 } from './legacy-field'
import { simulateRace, SIMULATION_ENGINE_VERSION, type RaceSimulationLog } from '../lib/career/race-simulation'

export const AUDIT_SEEDS = 12
export const AUDIT_RACES = [raceDefinitions[0], raceDefinitions[1], raceDefinitions[2]] // 1400 / 1600 / 2000
const CLOSE_FINISH_S = 0.1
const PASS_CLEARANCE_M = 1

export type AuditRow = {
  horse: string
  distance: number
  tactic: string
  seed: number
  placing: number
  runners: number
  /** Placing at the first MID marker versus final placing, over every runner. */
  earlyMatch: number
  earlySpearman: number
  /** Pair order changes between stored samples among runners still racing. */
  passes: number
  playerPassesNet: number
  playerLateDelta: number
  winnerMargin: number
}

const rankMapAt = (log: RaceSimulationLog, sampleIndex: number) => {
  const sample = log.samples[Math.min(sampleIndex, log.samples.length - 1)]
  return new Map(sample.runners.slice().sort((a, b) => b.distance - a.distance).map((runner, i) => [runner.horseId, i + 1]))
}
const sampleIndexAt = (log: RaceSimulationLog, tMs: number) => Math.max(0, log.samples.findIndex(sample => sample.tMs >= tMs))

export type AuditField = 'current' | 'v1'

export function makeAuditRun(horseIndex: number, raceIndex: number, tactic: typeof tactics[number], seed: number, field: AuditField = 'current') {
  const horse = horses[horseIndex]
  const career = { ...startCareer(horse.id), month: 3, careerTurnIndex: 3 }
  const race = AUDIT_RACES[raceIndex]
  let n = 0
  const key = `${horse.id}-${race.distance}-${tactic}-${seed}`
  const run = createRaceRun(career, race, contractedJockeys[1], tactic, () => (n++ === 0 ? `audit-run-${key}` : `audit-seed-${key}`))
  if (field === 'v1') run.runners = [run.runners[0], ...legacyFieldV1(race)]
  return { key, run, horse, race }
}

export function auditOne(horseIndex: number, raceIndex: number, tactic: typeof tactics[number], seed: number, simulate: (run: RaceRunInput) => RaceSimulationLog = simulateRace, field: AuditField = 'current'): AuditRow {
  const { run, horse, race } = makeAuditRun(horseIndex, raceIndex, tactic, seed, field)
  const log = simulate(run)
  const finalPlace = new Map(log.finishOrder.map(record => [record.horseId, record.placing]))
  const mid = log.phaseMarkers.find(marker => marker.phase === 'MID')
  const corner = log.phaseMarkers.find(marker => marker.phase === 'FINAL_CORNER')
  const early = rankMapAt(log, sampleIndexAt(log, mid?.tMs ?? 0))
  const total = run.runners.length
  let match = 0
  let squared = 0
  for (const [id, placing] of finalPlace) {
    const rank = early.get(id)!
    if (rank === placing) match += 1
    squared += (rank - placing) ** 2
  }
  // A pass is only counted once the pair has separated by PASS_CLEARANCE_M on the other side, so runners
  // swapping places within a body length do not inflate the count.
  let passes = 0
  let playerPassesNet = 0
  const settled = new Map<string, number>()
  for (let s = 0; s < log.samples.length; s += 1) {
    const runners = log.samples[s].runners
    for (let i = 0; i < runners.length; i += 1) {
      for (let j = i + 1; j < runners.length; j += 1) {
        if (runners[i].distance >= log.raceDistance || runners[j].distance >= log.raceDistance) continue
        const gap = runners[i].distance - runners[j].distance
        if (Math.abs(gap) < PASS_CLEARANCE_M) continue
        const side = Math.sign(gap)
        const key = `${i}:${j}`
        const before = settled.get(key)
        if (before !== undefined && before !== side) {
          passes += 1
          const involvesPlayer = runners[i].horseId === run.playerHorseId || runners[j].horseId === run.playerHorseId
          if (involvesPlayer) playerPassesNet += (runners[i].horseId === run.playerHorseId ? side : -side) > 0 ? 1 : -1
        }
        settled.set(key, side)
      }
    }
  }
  const cornerRanks = rankMapAt(log, sampleIndexAt(log, corner?.tMs ?? 0))
  return {
    horse: horse.name,
    distance: race.distance,
    tactic,
    seed,
    placing: log.result.placing,
    runners: total,
    earlyMatch: match / total,
    earlySpearman: 1 - (6 * squared) / (total * (total * total - 1)),
    passes,
    playerPassesNet,
    playerLateDelta: cornerRanks.get(run.playerHorseId)! - log.result.placing,
    winnerMargin: log.finishOrder[1].marginToWinner,
  }
}

export function runAudit(simulate: (run: RaceRunInput) => RaceSimulationLog = simulateRace, field: AuditField = 'current'): AuditRow[] {
  const rows: AuditRow[] = []
  for (let h = 0; h < horses.length; h += 1) for (let r = 0; r < AUDIT_RACES.length; r += 1) for (const tactic of tactics) for (let seed = 0; seed < AUDIT_SEEDS; seed += 1) rows.push(auditOne(h, r, tactic, seed, simulate, field))
  return rows
}

const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
const f = (value: number, digits = 2) => value.toFixed(digits)
export type Group = { label: string; n: number; avgPlace: number; winRate: number; top3: number; earlyMatch: number; earlySpearman: number; passes: number; lateDelta: number; closeRate: number; margin: number }
export function summarize(label: string, rows: AuditRow[]): Group {
  return {
    label,
    n: rows.length,
    avgPlace: mean(rows.map(r => r.placing)),
    winRate: mean(rows.map(r => (r.placing === 1 ? 1 : 0))),
    top3: mean(rows.map(r => (r.placing <= 3 ? 1 : 0))),
    earlyMatch: mean(rows.map(r => r.earlyMatch)),
    earlySpearman: mean(rows.map(r => r.earlySpearman)),
    passes: mean(rows.map(r => r.passes)),
    lateDelta: mean(rows.map(r => r.playerLateDelta)),
    closeRate: mean(rows.map(r => (r.winnerMargin <= CLOSE_FINISH_S ? 1 : 0))),
    margin: mean(rows.map(r => r.winnerMargin)),
  }
}
export function groups(rows: AuditRow[]) {
  const by = (pick: (row: AuditRow) => string | number) => [...new Set(rows.map(pick))].map(key => summarize(String(key), rows.filter(row => pick(row) === key)))
  return {
    all: [summarize('ALL', rows)],
    horse: by(r => r.horse),
    tactic: by(r => r.tactic),
    distance: by(r => `${r.distance}m`),
    horseTactic: by(r => `${r.horse}/${r.tactic}`),
    horseDistance: by(r => `${r.horse}/${r.distance}m`),
    tacticDistance: by(r => `${r.tactic}/${r.distance}m`),
  }
}
export function table(title: string, list: Group[]): string {
  const head = 'group'.padEnd(22) + ['n', 'avgPlace', 'win%', 'top3%', 'earlyMatch%', 'earlyRho', 'passes', 'lateDelta', 'close%', 'margin_s'].map(h => h.padStart(11)).join('')
  const lines = list.map(g => g.label.padEnd(22) + [String(g.n), f(g.avgPlace), f(g.winRate * 100, 1), f(g.top3 * 100, 1), f(g.earlyMatch * 100, 1), f(g.earlySpearman), f(g.passes, 1), f(g.lateDelta), f(g.closeRate * 100, 1), f(g.margin)].map(c => c.padStart(11)).join(''))
  return `## ${title}\n${head}\n${lines.join('\n')}\n`
}

if (process.argv[1]?.endsWith('race-audit.ts')) {
  const version = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined
  const field: AuditField = process.argv.includes('--field=v1') ? 'v1' : 'current'
  const rows = runAudit(run => simulateRace(run, version), field)
  const g = groups(rows)
  const out = [`engine ${version ?? SIMULATION_ENGINE_VERSION} runs ${rows.length}`, table('overall', g.all), table('by horse', g.horse), table('by tactic', g.tactic), table('by distance', g.distance), table('horse x tactic', g.horseTactic), table('tactic x distance', g.tacticDistance)].join('\n')
  console.log(out)
  const jsonIndex = process.argv.indexOf('--json')
  if (jsonIndex > 0) writeFileSync(process.argv[jsonIndex + 1], JSON.stringify({ engine: version ?? SIMULATION_ENGINE_VERSION, groups: g }, null, 1))
}
