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
import { validateSaveCommand } from '../lib/server-save/commands'

// Run from services/api so the existing fixture's seed and migration paths remain unchanged.
test('Frontend bridge/journal/adapter progresses Month 1–7 with server races in Month 3 and 6, reload and uncertain completion', async () => {
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
        body: { careerId: id, horseDefinitionId: 'DEV_HORSE_SERENE_STEP' },
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
      const selected = relations.data.find(relation => relation.jockeyId === command.body.jockeyId)!
      assert.deepEqual(state!.workspace!.career!.state.jockeyTrust![command.body.jockeyId], { starts: selected.starts, trust: selected.trust })
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
    await api.createCareer({ careerId: nextId, horseDefinitionId: 'DEV_HORSE_SERENE_STEP' })
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
