import { legacyCareer as startCareer } from './helpers/legacy-career'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { buildFixture } from '../lib/career/fixtures'
import { liveCommentary } from '../lib/career/race-feed'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import {
  RaceStrip,
  GapLane,
  PositionBoard,
  RaceFocus,
  Stage,
} from '../components/career/race-playback'
import { PositionHistory } from '../components/career/race-position-history'

import { contractedJockeys, createRaceRun, raceDefinitions } from '../lib/career/race-entry'
import { simulateRace, type RaceFrame } from '../lib/career/race-simulation'
import { analyzeRace, situationFrom, momentOf } from '../lib/career/race-spectate'

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

for (const version of ['race-sim-v1', 'race-sim-v2', 'race-sim-v3', 'race-sim-v4'] as const) {
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
          gates,
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

// Reuse the shipped 12/18-runner fixtures and all persisted engines; no invented racing data.
for (const field of [12, 18] as const) {
  test(`${field} runners: Korean labels, gates and readable identities follow actual start/finish frames`, () => {
    const fixture = buildFixture(`playback-${field}`)
    const savedRun = fixture.career!.raceRun!
    const savedNames = new Map(
      savedRun.runners.map((r) => [r.horseSnapshot.id, r.horseSnapshot.name]),
    )
    const savedGates = new Map(savedRun.runners.map((r, i) => [r.horseSnapshot.id, i + 1]))
    for (const version of ['race-sim-v1', 'race-sim-v2', 'race-sim-v3', 'race-sim-v4'] as const) {
      const log = simulateRace(savedRun, version)
      const before = JSON.stringify({ log, savedRun })
      const times = new Set([0, ...log.phaseMarkers.map((m) => m.tMs), log.durationMs])
      for (const time of times) {
        const a = analyzeRace(log, time, savedRun.playerHorseId)
        const html = renderToStaticMarkup(
          createElement(
            'div',
            null,
            createElement(RaceStrip, {
              frame: a.frame,
              runners: savedRun.runners,
              playerHorseId: savedRun.playerHorseId,
              names: savedNames,
              raceDistance: log.raceDistance,
              situation: a.now,
            }),
            createElement(RaceFocus, {
              frame: a.frame,
              situation: a.now,
              moment: momentOf(a),
              commentary: liveCommentary(log, a.frame.tMs, savedRun.playerHorseId, savedNames),
              speedLabel: '자동 · x4',
              names: savedNames,
              playerHorseId: savedRun.playerHorseId,
              gates: savedGates,
            }),
            createElement(PositionBoard, {
              frame: a.frame,
              playerHorseId: savedRun.playerHorseId,
              names: savedNames,
              raceDistance: log.raceDistance,
              gates: savedGates,
            }),
            createElement(PositionHistory, {
              log,
              frame: a.frame,
              playerHorseId: savedRun.playerHorseId,
              names: savedNames,
            }),
          ),
        )
        const dom = new JSDOM(html)
        try {
          const doc = dom.window.document
          assert.doesNotMatch(
            doc.body.textContent!,
            /FOCUS|POSITION BOARD|POSITION HISTORY|YOU|AUTO|START|FINISH/,
          )
          assert.equal(
            doc.querySelector('.race-focus-identity strong')!.textContent,
            savedNames.get(savedRun.playerHorseId),
          )
          assert.match(
            doc.querySelector('.race-focus-identity span')!.textContent!,
            /마번 1 · 출발 번호/,
          )
          assert.ok(doc.querySelector('.race-focus-rank')!.textContent!.includes(`${a.now.rank}위`))
          assert.equal(
            doc.querySelector('.race-focus-commentary')!.textContent,
            '실시간 중계' + liveCommentary(log, a.frame.tMs, savedRun.playerHorseId, savedNames),
          )
          const rows = [...doc.querySelectorAll<HTMLElement>('.race-board li')]
          assert.deepEqual(
            rows.map((row) => Number(row.dataset.rank)),
            a.frame.runners.map((r) => r.rank),
          )
          for (const row of rows) {
            assert.equal(Number(row.dataset.gate), savedGates.get(row.dataset.horseId!))
            assert.equal(row.querySelector('b')!.textContent, `${row.dataset.rank}위`)
            assert.equal(row.querySelector('small')!.textContent, `마번 ${row.dataset.gate}`)
          }
          assert.equal(doc.querySelectorAll('.race-board em').length, 1)
          assert.equal(doc.querySelector('.race-board em')!.textContent, '내 말')
          const player = a.frame.runners.find((r) => r.horseId === savedRun.playerHorseId)!
          assert.equal(
            Number(doc.querySelector('.race-focus')!.getAttribute('data-remaining')),
            Math.max(0, Math.round(log.raceDistance - player.distance)),
          )
          if (player.finished) {
            assert.ok(
              [...doc.querySelectorAll('.race-focus-gaps dd')].every(
                (el) => el.textContent === '결승 통과',
              ),
            )
          }
          assert.equal(
            doc.querySelectorAll('.race-focus [aria-live]').length,
            0,
            'rapid HUD changes are static readable content, not per-frame announcements',
          )
        } finally {
          dom.window.close()
        }
      }
      assert.equal(JSON.stringify({ log, savedRun }), before)
    }
  })
}

test('real playback controls preserve one RAF clock, shared frame and bounded announcements', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const previous = new Map<string, PropertyDescriptor | undefined>()
  const install = (key: string, value: unknown) => {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  let tick: FrameRequestCallback | undefined
  let rafCalls = 0
  let announce: (() => void) | undefined
  let cleared = false
  install('window', dom.window)
  install('document', dom.window.document)
  install('navigator', dom.window.navigator)
  for (const key of [
    'HTMLElement',
    'HTMLButtonElement',
    'Element',
    'Node',
    'Event',
    'MouseEvent',
  ] as const) {
    install(key, dom.window[key])
  }
  install('IS_REACT_ACT_ENVIRONMENT', true)
  install('requestAnimationFrame', (callback: FrameRequestCallback) => {
    tick = callback
    rafCalls += 1
    return rafCalls
  })
  install('cancelAnimationFrame', () => {
    tick = undefined
  })
  dom.window.setInterval = ((callback: () => void, delay: number) => {
    assert.equal(delay, 3000)
    announce = callback
    return 1
  }) as typeof dom.window.setInterval
  dom.window.clearInterval = () => {
    cleared = true
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  const fixture = buildFixture('playback-18')
  const run = fixture.career!.raceRun!
  const log = fixture.log!
  const original = JSON.stringify({ log, run })
  let finishes = 0
  let wall = performance.now() + 1
  const button = (name: string) =>
    [...dom.window.document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)!
  const advance = async (steps: number) => {
    for (let i = 0; i < steps; i += 1) {
      wall += 200
      await act(async () => tick!(wall))
    }
  }
  try {
    await act(async () =>
      root.render(
        createElement(Stage, {
          run,
          log,
          onFinish: () => {
            finishes += 1
          },
        }),
      ),
    )
    const doc = dom.window.document
    assert.deepEqual(
      [...doc.querySelectorAll('.race-phase-label')].map((el) => el.textContent),
      ['출발', '중반', '마지막 코너', '최종 직선', '결승'],
    )
    assert.match(doc.querySelector('.race-broadcast-header')!.textContent!, /잔디/)
    assert.equal(button('자동').getAttribute('aria-pressed'), 'true')
    assert.equal(doc.querySelector('[role="status"]')!.textContent, '')
    await advance(3)
    assert.equal(
      doc.querySelector('[role="status"]')!.textContent,
      '',
      'HUD updates do not announce',
    )
    await act(async () => announce!())
    assert.ok(doc.querySelector('[role="status"]')!.textContent)
    for (const speed of [1, 2, 4, 8]) {
      await act(async () => button(`x${speed}`).click())
      assert.equal(button(`x${speed}`).getAttribute('aria-pressed'), 'true')
      await advance(4)
      const frameMs = Number(doc.querySelector('.lab-playback')!.getAttribute('data-frame-ms'))
      const a = analyzeRace(log, frameMs, run.playerHorseId)
      for (const el of doc.querySelectorAll('[data-frame-ms]')) {
        assert.equal(Number(el.getAttribute('data-frame-ms')), frameMs)
      }
      assert.equal(Number(doc.querySelector('.race-focus')!.getAttribute('data-rank')), a.now.rank)
      assert.equal(
        doc.querySelector('.race-focus-commentary')!.textContent,
        '실시간 중계' +
          liveCommentary(
            log,
            frameMs,
            run.playerHorseId,
            new Map(run.runners.map((r) => [r.horseSnapshot.id, r.horseSnapshot.name])),
          ),
      )
      await act(async () => button('일시정지').click())
      await advance(5)
      assert.equal(
        Number(doc.querySelector('.lab-playback')!.getAttribute('data-frame-ms')),
        frameMs,
      )
      await act(async () => button('계속').click())
    }
    await act(async () => button('자동').click())
    assert.equal(button('자동').getAttribute('aria-pressed'), 'true')
    // Skip delegates once; the view itself never settles a race or modifies its saved data.
    await act(async () => button('건너뛰기').click())
    assert.equal(finishes, 1)
    await act(async () => button('x8').click())
    await advance(Math.ceil(log.durationMs / 1600) + 5)
    assert.ok(button('결과 확인'))
    await act(async () => button('결과 확인').click())
    assert.equal(finishes, 2)
    assert.equal(JSON.stringify({ log, run }), original)
    await act(async () => root.unmount())
    assert.equal(tick, undefined)
    assert.equal(cleared, true)
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor)
      } else {
        Reflect.deleteProperty(globalThis, key)
      }
    }
  }
})
