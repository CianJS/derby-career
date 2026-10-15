import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import { RaceStrip, GapLane, PositionBoard, RaceFocus } from '../components/career/race-playback'
import { PositionHistory } from '../components/career/race-position-history'
import { startCareer } from '../lib/career/model'
import { contractedJockeys, createRaceRun, raceDefinitions } from '../lib/career/race-entry'
import { simulateRace, type RaceFrame } from '../lib/career/race-simulation'
import { analyzeRace, situationFrom } from '../lib/career/race-spectate'

const career = { ...startCareer('DEV_HORSE_RED_COMET'), month: 3, careerTurnIndex: 3 }
let sequence = 0
const run = createRaceRun(
  career,
  raceDefinitions[0],
  contractedJockeys[0],
  '도주',
  () => `position-${sequence++}`,
)
const names = new Map(run.runners.map((r) => [r.horseSnapshot.id, r.horseSnapshot.name]))
const gates = new Map(run.runners.map((r, i) => [r.horseSnapshot.id, i + 1]))
function markerAttributes(html: string, horseId: string): string {
  const tag = html.split('<').find((tag) => tag.includes(`data-horse-id="${horseId}"`))
  assert.ok(tag)
  return tag.split('>')[0]
}

for (const version of ['race-sim-v1', 'race-sim-v2', 'race-sim-v3'] as const) {
  test(`${version}: strip, zoom and board show the same playback frame, including non-leading player positions`, () => {
    const log = simulateRace(run, version)
    const frozen = JSON.stringify(log)
    for (let t = 3000; t < log.durationMs; t += 4500) {
      const { frame, now } = analyzeRace(log, t, run.playerHorseId)
      const strip = renderToStaticMarkup(
        createElement(RaceStrip, {
          frame,
          runners: run.runners,
          playerHorseId: run.playerHorseId,
          names,
          raceDistance: log.raceDistance,
          situation: now,
        }),
      )
      const zoom = renderToStaticMarkup(
        createElement(GapLane, { frame, situation: now, playerHorseId: run.playerHorseId, gates }),
      )
      const board = renderToStaticMarkup(
        createElement(PositionBoard, {
          frame,
          playerHorseId: run.playerHorseId,
          names,
          raceDistance: log.raceDistance,
        }),
      )
      const focus = renderToStaticMarkup(
        createElement(RaceFocus, {
          frame,
          situation: now,
          moment: null,
          commentary: '',
          speedLabel: 'x1',
          names,
          playerHorseId: run.playerHorseId,
          gates,
        }),
      )
      const history = renderToStaticMarkup(
        createElement(PositionHistory, {
          log,
          frame,
          playerHorseId: run.playerHorseId,
          names,
        }),
      )
      assert.match(focus, new RegExp(`data-rank="${now.rank}"`))
      assert.match(
        focus,
        new RegExp(
          `data-remaining="${Math.max(0, Math.round(log.raceDistance - frame.runners.find((r) => r.horseId === run.playerHorseId)!.distance))}"`,
        ),
      )
      assert.match(focus, /내 말 남은 거리/)
      assert.match(history, new RegExp(`data-player-rank="${now.rank}"`))
      for (const html of [strip, board, focus, history]) {
        assert.match(html, new RegExp(`data-frame-ms="${frame.tMs}"`))
      }
      assert.match(board, new RegExp(`${now.rank}위 / ${frame.runners.length}두`))
      const me = frame.runners.find((r) => r.horseId === run.playerHorseId)!
      assert.match(markerAttributes(strip, me.horseId), new RegExp(`data-rank="${now.rank}"`))
      assert.match(markerAttributes(zoom, me.horseId), new RegExp(`data-rank="${now.rank}"`))
      for (const runner of frame.runners) {
        const stripX = Number(
          /--strip-x:([^;" ]+)/.exec(markerAttributes(strip, runner.horseId))![1],
        )
        assert.equal(stripX, runner.distance / log.raceDistance)
        if (zoom.includes(`data-horse-id="${runner.horseId}"`)) {
          const zoomX = Number(/left:([^%]+)%/.exec(markerAttributes(zoom, runner.horseId))![1])
          assert.equal(Math.sign(zoomX - 50), Math.sign(runner.distance - me.distance))
        }
        if (!runner.finished && !me.finished && runner.distance > me.distance) {
          assert.ok(runner.rank < me.rank)
        }
      }
    }
    assert.equal(JSON.stringify(log), frozen, 'view rendering must not modify saved logs')
  })
}

test('gate 1 can be third: marker numbers are gate identifiers and both views use current rank', () => {
  const ids = run.runners.slice(0, 3).map((r) => r.horseSnapshot.id)
  const frame: RaceFrame = {
    tMs: 10000,
    phase: 'MID',
    remaining: 800,
    runners: [
      { horseId: ids[1], distance: 600, lane: 0, rank: 1, finished: false },
      { horseId: ids[2], distance: 590, lane: 0, rank: 2, finished: false },
      { horseId: ids[0], distance: 580, lane: 0, rank: 3, finished: false },
    ],
  }
  const situation = situationFrom(frame, ids[0], 1400)
  const strip = renderToStaticMarkup(
    createElement(RaceStrip, {
      frame,
      runners: run.runners.slice(0, 3),
      playerHorseId: ids[0],
      names,
      raceDistance: 1400,
      situation,
    }),
  )
  assert.match(markerAttributes(strip, ids[0]), /마번 1 .*현재 3위/)
  assert.equal(situation.rank, 3)
  assert.equal(situation.ahead?.horseId, ids[2])
})

test('marker centre is independent of name label width and has no delayed position transition', () => {
  const css = postcss.parse(readFileSync('app/globals.css', 'utf8'))
  const declarations = (selector: string) => {
    const result: Record<string, string> = {}
    css.walkRules((rule) => {
      if (
        rule.selector
          .split(',')
          .map((part) => part.trim())
          .includes(selector)
      ) {
        rule.walkDecls((decl) => {
          result[decl.prop] = decl.value
        })
      }
    })
    return result
  }
  const anchor = declarations('.race-strip-runner')
  const player = declarations('.race-strip-runner.is-player')
  const circle = declarations('.race-strip-runner b')
  const playerCircle = declarations('.race-strip-runner.is-player b')
  assert.equal(anchor.width, circle.width)
  assert.equal(player.width, playerCircle.width)
  assert.equal(declarations('.race-strip-runner span').position, 'absolute')
  assert.equal(declarations('.race-strip-runner small').position, 'absolute')
  for (const selector of ['.race-strip-runner', '.race-gap-dot']) {
    assert.ok(!declarations(selector).transition?.includes('left'))
  }
  // translate(-50%) centres only the fixed circle-sized anchor, regardless of any label length.
  for (const labelWidth of [0, 80, 240]) {
    const left = 420
    const markerWidth = parseFloat(player.width) * 16
    const anchorWidth = parseFloat(player.width) * 16
    const inFlowLabelWidth =
      declarations('.race-strip-runner span').position === 'absolute' ? 0 : labelWidth
    assert.equal(left - (anchorWidth + inFlowLabelWidth) / 2 + markerWidth / 2, left)
  }
})
