import type { components } from '../packages/shared/src/generated/api'
import { serverEventChoiceAvailability } from '../packages/shared/src/event-availability'
import { canTrain } from '../lib/career/health'
import { readCareerStory, serverStoryEntries } from '../lib/server-save/career-story'
type Models = components['schemas']
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture } from '../services/api/tests/helpers'
import { createApiClient } from '../packages/shared/src/client'
import {
  ServerSaveController,
  type SaveSnapshot,
  type CommandJournal,
} from '../lib/server-save/controller'
import { handleServerSave } from '../lib/server-save/bridge'
import { createRaceDataAdapter } from '../lib/career/race-data-adapter'
import { recommendRaceEntry } from '../lib/career/race-entry-recommendation'
import { gameRaceSchedule } from '../components/career/game-race-schedule'
import { validateSaveCommand } from '../lib/server-save/commands'

// Run from services/api so the existing fixture's seed and migration paths remain unchanged.
test('Frontend bridge/journal/adapter progresses Month 1–7 with server races in Month 3 and 6, reload and uncertain completion', async (t) => {
  const f = await fixture()
  try {
    let journalText: string | null = null
    const journal: CommandJournal = {
      read: () => journalText,
      write: (v) => {
        journalText = v
      },
      clear: () => {
        journalText = null
      },
    }
    let state: SaveSnapshot
    const requests: { path: string; body: unknown }[] = []
    let loseComplete = false
    let waitComplete = false
    let release: (() => void) | undefined
    const api = createApiClient({
      baseUrl: 'http://localhost:3000/api/server-save',
      fetch: async (input, init) => {
        const req = new Request(String(input), {
          ...init,
          headers: {
            ...(init?.headers as Record<string, string>),
            ...(init?.method === 'POST' ? { Origin: 'http://localhost:3000' } : {}),
          },
        })
        return handleServerSave(
          req,
          {
            NODE_ENV: 'development',
            DERBY_SAVE_MODE: 'server',
            DERBY_SERVER_SAVE_LOCAL: '1',
            DERBY_API_DEV_SESSION_TOKEN: f.user.token,
          },
          async (target, options) => {
            const url = new URL(String(target))
            const body = options?.body ? JSON.parse(String(options.body)) : undefined
            requests.push({ path: url.pathname, body })
            const res = await f.app.inject({
              method: options?.method as 'GET' | 'POST',
              url: url.pathname + url.search,
              payload: body,
              headers: {
                authorization: (options?.headers as Record<string, string>).Authorization,
              },
            })
            if (url.pathname.endsWith('/complete') && loseComplete) {
              loseComplete = false
              throw new Error('response lost after commit')
            }
            if (url.pathname.endsWith('/complete') && waitComplete) {
              waitComplete = false
              await new Promise<void>((resolve) => {
                release = resolve
              })
            }
            return new Response(res.body, {
              status: res.statusCode,
              headers: { 'Content-Type': 'application/json' },
            })
          },
        )
      },
    })
    const controller = () =>
      new ServerSaveController(api, journal, (value) => {
        state = value
      })
    let c = controller()
    assert.equal(await c.refresh(), true)
    const id = randomUUID()
    assert.equal(
      await c.send({
        kind: 'create',
        body: {
          careerId: id,
          horseDefinitionId: 'DEV_HORSE_SERENE_STEP',
          starterJockeyId: 'HAN_DOYUN' as const,
        },
      }),
      true,
    )
    const settleEvent = async () => {
      const current = state!.workspace!.career!
      if (current.event?.state === 'pending') {
        const choice = current.event.definition.choices[0]
        assert.equal(
          await c.send({
            kind: 'event',
            careerId: id,
            historyId: current.event.id,
            body: {
              commandId: randomUUID(),
              choiceId: choice.id,
              expectedTurn: current.state.careerTurnIndex,
            },
          }),
          true,
        )
      }
    }
    let expectedPrize = 0
    for (let month = 1; month <= 6; month++) {
      assert.equal(state!.workspace!.career!.state.careerTurnIndex, month)
      await settleEvent()
      if (month !== 3 && month !== 6) {
        assert.equal(
          await c.send({
            kind: 'action',
            careerId: id,
            body: { actionId: randomUUID(), choice: 'rest', expectedTurn: month },
          }),
          true,
        )
        await settleEvent()
        assert.equal(
          await c.send({
            kind: 'advance',
            careerId: id,
            body: {
              commandId: randomUUID(),
              actionId: state!.workspace!.confirmedActionId!,
              expectedTurn: month,
            },
          }),
          true,
        )
        continue
      }
      const options = state!.raceOptions!
      const schedule = gameRaceSchedule({
        ...state!,
        mode: 'server',
        career: state!.workspace!.career!.state,
        lifecycle: null,
        localCareerId: null,
      })
      assert.equal(schedule.currentCount, options.races.length)
      assert.equal(schedule.readyCount, options.races.filter((row) => row.eligible).length)
      for (const entry of options.races) {
        const displayed = schedule.rows.find((row) => row.definition.id === entry.definition.id)!
        assert.deepEqual(displayed.definition, entry.definition)
        assert.equal(displayed.canPrepare, entry.eligible && !options.restrictionReason)
      }
      const draft = recommendRaceEntry(state!.workspace!.career!.state, undefined, options)
      assert.ok(draft.raceId && draft.jockeyId && draft.tactic)
      const command = {
        kind: 'race-entry' as const,
        careerId: id,
        body: {
          raceRunId: randomUUID(),
          raceDefinitionId: draft.raceId!,
          jockeyId: draft.jockeyId!,
          tactic: draft.tactic!,
          expectedTurn: month,
          engineVersion: 'race-sim-v4' as const,
        },
      }
      assert.ok(validateSaveCommand(command))
      assert.equal(await c.send(command), true)
      c.dispose()
      c = controller()
      assert.equal(await c.refresh(), true) // reload immediately after entry
      const adapter = createRaceDataAdapter('server', api, () => {
        throw new Error('Local Save forbidden')
      })
      const data = await adapter.load(state!.workspace!.career!.state, id)
      assert.equal(data.log.engineVersion, 'race-sim-v4')
      c.dispose()
      c = controller()
      assert.equal(await c.refresh(), true) // reload while watching
      const replay = await adapter.load(state!.workspace!.career!.state, id)
      assert.equal(JSON.stringify(replay.log), JSON.stringify(data.log))
      const funds = state!.workspace!.stable!.funds
      const complete = {
        kind: 'race-complete' as const,
        careerId: id,
        raceRunId: command.body.raceRunId,
        body: { commandId: randomUUID() },
      }
      if (month === 3) {
        loseComplete = true
        assert.equal(await c.send(complete), false)
        assert.equal(state!.pending, true)
        assert.deepEqual(JSON.parse(journalText!), complete)
        assert.equal(await c.send({ ...complete, body: { commandId: randomUUID() } }), false)
        c.dispose()
        c = controller()
        assert.equal(await c.refresh(), true)
      } else {
        waitComplete = true
        const running = c.send(complete)
        // Let the real server commit, then switch the controller (as the store does for a mode change).
        for (let attempt = 0; !release && attempt < 100; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        assert.ok(release)
        c.dispose()
        release!()
        assert.equal(await running, false)
        assert.deepEqual(JSON.parse(journalText!), complete)
        c = controller()
        assert.equal(await c.refresh(), true)
      }
      assert.equal(state!.pending, false)
      assert.equal(journalText, null)
      assert.equal(state!.workspace!.career!.state.careerTurnIndex, month + 1)
      assert.equal(state!.workspace!.career!.state.raceRun, undefined)
      assert.equal(state!.workspace!.stable!.funds, funds + data.log.result.prizeMoney)
      expectedPrize += data.log.result.prizeMoney
      const records = state!.workspace!.career!.state.raceRecords
      assert.equal(records.length, month === 3 ? 1 : 2)
      assert.equal(
        records.reduce((sum, r) => sum + (r.prizeMoney ?? 0), 0),
        expectedPrize,
      )
      const relations = await api.getJockeyRelations(id)
      const selected = relations.data.find(
        (relation) => relation.jockeyId === command.body.jockeyId,
      )!
      assert.deepEqual(state!.workspace!.career!.state.jockeyTrust![command.body.jockeyId], {
        starts: selected.starts,
        trust: selected.trust,
      })
      assert.equal(selected.trust, records.at(-1)!.trustChange!.after)
      const posts = requests.filter(
        (r) =>
          r.path.endsWith('/complete') &&
          (r.body as { commandId: string }).commandId === complete.body.commandId,
      )
      assert.equal(posts.length, 2)
      assert.deepEqual(posts[0].body, posts[1].body)
      assert.equal(
        requests.some(
          (r) =>
            r.path.endsWith('/months/advance') &&
            (r.body as { expectedTurn: number }).expectedTurn === month,
        ),
        false,
      )
      c.dispose()
      c = controller()
      assert.equal(await c.refresh(), true)
      assert.equal(state!.workspace!.career!.state.careerTurnIndex, month + 1)
    }
    // History reads represent a later screen visit after six compressed monthly sessions.
    const historyWall = Date.now()
    t.mock.method(Date, 'now', () => historyWall + 61000)
    const history = await readCareerStory(api, id, false)
    assert.equal(history.records.length, 2)
    const story = serverStoryEntries(history, state!.workspace!.career!)
    assert.equal(story.filter((entry) => entry.kind === 'race').length, 2)
    assert.equal(
      story.some((entry) => entry.kind === 'retirement'),
      false,
    )
    for (const record of history.records) {
      const entry = story.find((item) => item.raceRunId === record.raceRunId)!
      assert.ok(
        entry.details.some((text) => text.includes(record.prizeMoney!.toLocaleString('ko-KR'))),
      )
      assert.ok(
        entry.details.some((text) =>
          text.includes(`신뢰도 ${record.trustChange!.before} → ${record.trustChange!.after}`),
        ),
      )
    }
  } finally {
    await f.close()
  }
})

test('a late completion receipt never overwrites a newer server Career workspace', async () => {
  const f = await fixture()
  try {
    const { id } = await f.create()
    for (let turn = 1; turn < 3; turn++) {
      const actionId = randomUUID()
      assert.equal(
        (
          await f.call('POST', `/v1/careers/${id}/actions`, {
            actionId,
            choice: 'rest',
            expectedTurn: turn,
          })
        ).statusCode,
        200,
      )
      assert.equal(
        (
          await f.call('POST', `/v1/careers/${id}/months/advance`, {
            commandId: randomUUID(),
            actionId,
            expectedTurn: turn,
          })
        ).statusCode,
        200,
      )
    }
    let text: string | null = null
    let state: SaveSnapshot
    const api = createApiClient({
      baseUrl: 'http://api',
      getSessionToken: () => f.user.token,
      fetch: async (input, init) => {
        const response = await f.app.inject({
          method: init?.method as 'GET' | 'POST',
          url: new URL(String(input)).pathname + new URL(String(input)).search,
          headers: { authorization: 'Bearer ' + f.user.token },
          payload: init?.body ? JSON.parse(String(init.body)) : undefined,
        })
        return new Response(response.body, { status: response.statusCode })
      },
    })
    const c = new ServerSaveController(
      api,
      {
        read: () => text,
        write: (v) => {
          text = v
        },
        clear: () => {
          text = null
        },
      },
      (v) => {
        state = v
      },
    )
    assert.equal(await c.refresh(), true)
    await f.db.query(
      "UPDATE careers SET state=jsonb_set(state,'{health}','\"중상\"') WHERE id=$1",
      [id],
    )
    assert.equal(await c.refresh(), true)
    assert.ok(state!.raceOptions!.restrictionReason)
    assert.ok(state!.raceOptions!.races.every((row) => !row.eligible))
    await f.db.query(
      "UPDATE careers SET state=jsonb_set(state,'{health}','\"정상\"') WHERE id=$1",
      [id],
    )
    assert.equal(await c.refresh(), true)
    const options = state!.raceOptions!
    const draft = recommendRaceEntry(state!.workspace!.career!.state, undefined, options)
    const runId = randomUUID()
    assert.equal(
      await c.send({
        kind: 'race-entry',
        careerId: id,
        body: {
          raceRunId: runId,
          raceDefinitionId: draft.raceId!,
          jockeyId: draft.jockeyId!,
          tactic: draft.tactic!,
          expectedTurn: 3,
        },
      }),
      true,
    )
    const complete = {
      kind: 'race-complete' as const,
      careerId: id,
      raceRunId: runId,
      body: { commandId: randomUUID() },
    }
    const completed = await api.completeRace(id, runId, complete.body)
    await api.retireCareer(id, {
      commandId: randomUUID(),
      expectedRevision: completed.career.revision,
    })
    const nextId = randomUUID()
    await api.createCareer({
      careerId: nextId,
      horseDefinitionId: 'DEV_HORSE_SERENE_STEP',
      starterJockeyId: 'HAN_DOYUN' as const,
    })
    text = JSON.stringify(complete) // restore a tab whose receipt was lost before the other tab moved on
    assert.equal(await c.refresh(), true)
    assert.equal(state!.workspace!.career!.id, nextId)
    assert.equal(state!.workspace!.career!.state.careerTurnIndex, 1)
    assert.equal(state!.workspace!.career!.state.raceRun, undefined)
    assert.equal(state!.workspace!.retirements.length, 1)
    assert.equal(text, null)
  } finally {
    await f.close()
  }
})

test('retirement story bridge reads every real API page, trips and event states for A without borrowing B', async (t) => {
  const f = await fixture({ probability: 1 })
  try {
    let batchRequest = 0
    // Compress only the HTTP limiter's wall clock; all records still come from real API commands.
    const wall = Date.now()
    t.mock.method(Date, 'now', () => wall + Math.floor(batchRequest / 30) * 61000)
    const call = (method: 'GET' | 'POST', url: string, payload?: unknown) => {
      batchRequest += 1
      return f.app.inject({
        method,
        url,
        payload: payload as Record<string, unknown> | undefined,
        remoteAddress: '127.0.0.1',
        headers: { authorization: `Bearer ${f.user.token}` },
      })
    }
    const created = await f.create()
    const id = created.id
    const base = `/v1/careers/${id}`
    const get = async () => (await call('GET', base)).json<Models['CareerResponse']>().career
    const eventStates = new Map<string, Models['CareerEvent']>()
    const remember = (career: Models['Career']) => {
      if (career.event) {
        eventStates.set(career.event.state, structuredClone(career.event))
      }
    }
    for (let turn = 1; turn <= 62; turn += 1) {
      let career = await get()
      remember(career)
      if (career.event?.state === 'pending') {
        const choice = career.event.definition.choices.find(
          (option) =>
            serverEventChoiceAvailability(career.event!.definition, option, {
              career: career.state,
            }).available,
        )
        assert.ok(choice)
        const selected = await call('POST', `${base}/events/${career.event.id}/choice`, {
          commandId: randomUUID(),
          choiceId: choice.id,
          expectedTurn: turn,
        })
        assert.equal(selected.statusCode, 200, selected.body)
        career = selected.json<Models['CareerResponse']>().career
        remember(career)
      }
      if (turn <= 21 || turn === 61 || turn === 62) {
        for (const targetCountry of ['JPN', 'USA']) {
          const travel = (await call('GET', base + '/expedition')).json<
            Models['ExpeditionResponse']
          >().travel
          const start = await call('POST', base + '/expeditions', {
            commandId: randomUUID(),
            targetCountry,
            expectedTravelRevision: travel.revision,
          })
          assert.equal(start.statusCode, 200, start.body)
          const started = start.json<Models['CareerResponse']>().career.travel!
          if (turn === 62 && targetCountry === 'USA') {
            continue
          }
          const returned = await call(
            'POST',
            `${base}/expeditions/${started.activeExpedition!.id}/return`,
            { commandId: randomUUID(), expectedTravelRevision: started.revision },
          )
          assert.equal(returned.statusCode, 200, returned.body)
        }
      }
      const actionId = randomUUID()
      const response = await call('POST', base + '/actions', {
        actionId,
        choice:
          turn % 4 === 0 && canTrain(career.state.health)
            ? 'speed'
            : !canTrain(career.state.health)
              ? 'treatment'
              : 'rest',
        expectedTurn: turn,
      })
      assert.equal(response.statusCode, 200, response.body)
      remember(response.json<Models['ActionResponse']>().career)
      if (turn < 62) {
        const next = await call('POST', base + '/months/advance', {
          commandId: randomUUID(),
          actionId,
          expectedTurn: turn,
        })
        assert.equal(next.statusCode, 200, next.body)
      }
    }
    const final = await get()
    const retiredResponse = await call('POST', base + '/retirement', {
      commandId: randomUUID(),
      expectedRevision: final.revision,
    })
    assert.equal(retiredResponse.statusCode, 200, retiredResponse.body)
    const retired = retiredResponse.json<Models['RetireCareerResponse']>().retirement
    const next = await f.create()
    const requests: string[] = []
    let failOnce = true
    let invalid = false
    const api = createApiClient({
      baseUrl: 'http://localhost:3000/api/server-save',
      fetch: async (input, init) =>
        handleServerSave(
          new Request(String(input), init),
          {
            NODE_ENV: 'development',
            DERBY_SAVE_MODE: 'server',
            DERBY_SERVER_SAVE_LOCAL: '1',
            DERBY_API_DEV_SESSION_TOKEN: f.user.token,
          },
          async (target, options) => {
            const url = new URL(String(target))
            assert.equal(options?.method, 'GET')
            assert.equal(
              new Headers(options?.headers).get('Authorization'),
              `Bearer ${f.user.token}`,
            )
            requests.push(url.pathname + url.search)
            if (url.search.includes('page=2') && failOnce) {
              failOnce = false
              return Response.json({ error: { message: f.user.token } }, { status: 503 })
            }
            const response = await call('GET', url.pathname + url.search)
            const data = response.json()
            if (invalid && url.pathname.endsWith('/expeditions/history') && data.data.length) {
              data.data[0].careerId = next.id
            }
            return Response.json(data, { status: response.statusCode })
          },
        ),
    })
    const before = (await call('GET', base + '/retirement')).body
    await assert.rejects(
      readCareerStory(api, id, true),
      (error) => error instanceof Error && !error.message.includes(f.user.token),
    )
    const data = await readCareerStory(api, id, true)
    assert.equal(data.actions.length, 62)
    assert.equal(data.expeditions.length, 46)
    assert.ok(data.events.length > 20)
    assert.deepEqual(data.retirement, retired)
    assert.ok(data.expeditions.every((trip) => trip.careerId === id))
    assert.equal(data.expeditions.filter((trip) => trip.endReason === 'retirement').length, 1)
    assert.ok(requests.some((path) => path === base + '/actions?page=5&pageSize=20'))
    assert.ok(requests.some((path) => path === base + '/expeditions/history?page=4&pageSize=20'))
    const entries = serverStoryEntries(data, retired.snapshot)
    assert.equal(entries.filter((entry) => entry.kind === 'departure').length, 46)
    assert.equal(entries.filter((entry) => entry.kind === 'return').length, 46)
    assert.ok(entries.some((entry) => entry.title.includes('은퇴로 종료')))
    assert.equal(entries.filter((entry) => entry.kind === 'retirement').length, 1)
    assert.ok(entries.some((entry) => entry.turn === 62))
    assert.equal((await call('GET', base + '/retirement')).body, before)
    assert.equal(
      (await call('GET', `/v1/careers/${next.id}`)).json().career.state.careerTurnIndex,
      1,
    )
    for (const event of eventStates.values()) {
      const items = serverStoryEntries(
        { actions: [], records: [], expeditions: [], events: [event] },
        retired.snapshot,
      )
      assert.equal(items.length, 1)
      assert.equal(
        items[0].changes?.length ?? 0,
        event.state === 'pending' ? 0 : (event.result?.changes.length ?? 0),
      )
      assert.ok(
        items[0].details.some((text) =>
          text.includes(
            event.state === 'pending'
              ? '미선택'
              : event.state === 'expired'
                ? '만료'
                : event.state === 'selected'
                  ? '선택됨'
                  : '적용됨',
          ),
        ),
      )
    }
    let selectedId = id
    let release!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const delayed = {
      ...api,
      listActions: async (...args: Parameters<typeof api.listActions>) => {
        const rows = await api.listActions(...args)
        if (args[0] === id && args[1]?.page === 1) {
          await hold
        }
        return rows
      },
    }
    const late = readCareerStory(delayed, id, true, () => selectedId === id)
    const canceled = assert.rejects(late, /변경/)
    selectedId = next.id
    const nextData = await readCareerStory(api, next.id, false)
    assert.equal(nextData.actions.length, 0)
    assert.equal(nextData.records.length, 0)
    assert.equal(nextData.expeditions.length, 0)
    release()
    await canceled
    invalid = true
    await assert.rejects(readCareerStory(api, id, true), /계약|이력|저장/)
    invalid = false
    await assert.rejects(
      readCareerStory(api, id, true, () => false),
      /변경/,
    )
    const anonymous = await handleServerSave(
      new Request('http://localhost:3000/api/server-save' + base + '/events?page=1&pageSize=20'),
      {
        NODE_ENV: 'development',
        DERBY_SAVE_MODE: 'server',
        DERBY_SERVER_SAVE_LOCAL: '1',
        DERBY_API_DEV_SESSION_TOKEN: f.other.token,
      },
      async (target, options) => {
        const url = new URL(String(target))
        const response = await f.app.inject({
          method: 'GET',
          url: url.pathname + url.search,
          headers: { authorization: new Headers(options?.headers).get('Authorization')! },
        })
        return Response.json(response.json(), { status: response.statusCode })
      },
    )
    assert.equal(anonymous.status, 404)
  } finally {
    await f.close()
  }
})
