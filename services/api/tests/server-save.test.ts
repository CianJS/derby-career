import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture } from './helpers'
import { createApiClient } from '../../../packages/shared/src/client'
import { validateCareerWorkspace } from '../../../packages/shared/src/generated/save-validation.mjs'
import {
  ServerSaveController,
  type SaveSnapshot,
  type SaveCommand,
} from '../../../lib/server-save/controller'
import { handleServerSave } from '../../../lib/server-save/bridge'
import { serverLifecycle } from '../../../lib/server-save/lifecycle'
import { importEvents, convertNotionRows } from '../src/modules/events/import'
import { catalogSource } from './helpers'
import { digest } from '../src/services/identity'

function headersObject(value?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {}
  new Headers(value).forEach((entry, key) => {
    result[key] = entry
  })
  return result
}

test('workspace restores active action UUID and owner-scoped, paginated immutable retirements', async () => {
  const f = await fixture()
  try {
    const empty = await f.call('GET', '/v1/careers/workspace')
    assert.equal(empty.statusCode, 200)
    assert.deepEqual(empty.json(), {
      stable: null,
      career: null,
      confirmedActionId: null,
      retirements: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    })
    const { id } = await f.create()
    const actionId = randomUUID()
    const action = await f.call('POST', `/v1/careers/${id}/actions`, {
      actionId,
      choice: 'speed',
      expectedTurn: 1,
    })
    assert.equal(action.statusCode, 200, action.body)
    const active = (await f.call('GET', '/v1/careers/workspace')).json()
    assert.ok(validateCareerWorkspace(active))
    assert.ok(active.career?.state.action)
    assert.equal(active.confirmedActionId, actionId)
    assert.notEqual(active.confirmedActionId, active.career.state.action.actionId)
    const retired = await f.call('POST', `/v1/careers/${id}/retirement`, {
      commandId: randomUUID(),
      expectedRevision: active.career.revision,
    })
    assert.equal(retired.statusCode, 200, retired.body)
    const immutable = retired.json().retirement
    await f.db.query('UPDATE stables SET funds=funds+700 WHERE owner_id=$1', [f.user.principalId])
    const second = await f.create()
    const secondGet = (await f.call('GET', `/v1/careers/${second.id}`)).json().career
    assert.equal(
      (
        await f.call('POST', `/v1/careers/${second.id}/retirement`, {
          commandId: randomUUID(),
          expectedRevision: secondGet.revision,
        })
      ).statusCode,
      200,
    )
    const page1 = (await f.call('GET', '/v1/careers/workspace?page=1&pageSize=1')).json()
    const page2 = (await f.call('GET', '/v1/careers/workspace?page=2&pageSize=1')).json()
    assert.ok(validateCareerWorkspace(page1))
    assert.ok(validateCareerWorkspace(page2))
    assert.equal(page1.pagination.total, 2)
    assert.equal(page1.pagination.totalPages, 2)
    assert.notEqual(page1.retirements[0].careerId, page2.retirements[0].careerId)
    assert.deepEqual(
      [page1, page2].flatMap((p) => p.retirements).find((r) => r.careerId === id),
      immutable,
    )
    assert.ok(page1.stable)
    assert.equal(page1.stable.funds, immutable.snapshot.funds + 700)
    // Exercise the archive UI's 20-item boundary with actual server snapshots.
    for (let i = 0; i < 19; i++) {
      const next = await f.create()
      assert.equal(
        (
          await f.call('POST', `/v1/careers/${next.id}/retirement`, {
            commandId: randomUUID(),
            expectedRevision: next.response.career.revision,
          })
        ).statusCode,
        200,
      )
    }
    const archiveApi = createApiClient({
      baseUrl: 'http://api',
      getSessionToken: () => f.user.token,
      fetch: async (input, init) => {
        const url = new URL(String(input))
        const response = await f.app.inject({
          method: 'GET',
          url: url.pathname + url.search,
          headers: headersObject(init?.headers),
        })
        return new Response(response.body, { status: response.statusCode })
      },
    })
    let archives: SaveSnapshot | undefined
    const reader = new ServerSaveController(
      archiveApi,
      { read: () => null, write: () => {}, clear: () => {} },
      (state) => {
        archives = state
      },
    )
    assert.equal(await reader.refresh(), true)
    assert.equal(archives!.workspace!.retirements.length, 20)
    await reader.loadMore()
    assert.equal(archives!.workspace!.retirements.length, 21)
    const oldest = archives!.workspace!.retirements[20].careerId
    assert.equal(await reader.refresh(), true)
    assert.equal(archives!.workspace!.retirements.length, 21)
    assert.equal(archives!.workspace!.retirements[20].careerId, oldest)
    assert.equal(archives!.workspace!.pagination.page, 2)
    const foreign = (await f.call('GET', '/v1/careers/workspace', undefined, f.other.token)).json()
    assert.equal(foreign.stable, null)
    assert.equal(foreign.retirements.length, 0)
    assert.equal((await f.call('GET', '/v1/careers/workspace?page=0')).statusCode, 400)
    const noSession = await f.app.inject({ method: 'GET', url: '/v1/careers/workspace' })
    assert.equal(noSession.statusCode, 401)
  } finally {
    await f.close()
  }
})

test('server-save bridge and controller recover a lost response across reload and ignore historical receipt state', async () => {
  const f = await fixture()
  try {
    const env = {
      NODE_ENV: 'development',
      DERBY_SAVE_MODE: 'server',
      DERBY_SERVER_SAVE_LOCAL: '1',
      DERBY_API_URL: 'http://127.0.0.1:4000',
      DERBY_API_DEV_SESSION_TOKEN: f.user.token,
    }
    const posts: { path: string; body: string }[] = []
    let loseResponse = false
    const upstream: typeof fetch = async (input, init) => {
      const url = new URL(String(input))
      if (init?.method === 'POST') {
        posts.push({ path: url.pathname, body: String(init.body) })
      }
      const response = await f.app.inject({
        method: init?.method === 'POST' ? 'POST' : 'GET',
        url: url.pathname + url.search,
        headers: headersObject(init?.headers),
        payload: init?.body as string | undefined,
      })
      if (loseResponse && init?.method === 'POST') {
        loseResponse = false
        throw new Error('Response lost after commit')
      }
      return new Response(response.body, { status: response.statusCode })
    }
    const browser: typeof fetch = (input, init) =>
      handleServerSave(
        new Request(new URL(String(input), 'http://127.0.0.1:3000'), {
          ...init,
          headers: { ...headersObject(init?.headers), Origin: 'http://127.0.0.1:3000' },
        }),
        env,
        upstream,
      )
    const api = createApiClient({ baseUrl: '/api/server-save', fetch: browser })
    let saved: string | null = null
    const journal = {
      read: () => saved,
      write: (value: string) => {
        saved = value
      },
      clear: () => {
        saved = null
      },
    }
    let state: SaveSnapshot | undefined
    let controller = new ServerSaveController(api, journal, (next) => {
      state = next
    })
    assert.equal(await controller.refresh(), true)
    assert.equal(state!.candidates.length, 3)
    const id = randomUUID()
    assert.equal(
      await controller.send({
        kind: 'create',
        body: { careerId: id, horseDefinitionId: 'DEV_HORSE_SERENE_STEP' },
      }),
      true,
    )
    const command: SaveCommand = {
      kind: 'action',
      careerId: id,
      body: { actionId: randomUUID(), choice: 'speed', expectedTurn: 1 },
    }
    loseResponse = true
    assert.equal(await controller.send(command), false)
    assert.equal(state!.pending, true)
    assert.equal(state!.workspace!.career!.state.action, null)
    assert.deepEqual(JSON.parse(saved!), command)
    assert.equal(
      await controller.send({ ...command, body: { ...command.body, actionId: randomUUID() } }),
      false,
    )
    assert.equal(posts.length, 2)
    controller = new ServerSaveController(api, journal, (next) => {
      state = next
    })
    assert.equal(await controller.refresh(), true)
    assert.equal(saved, null)
    assert.equal(state!.workspace!.confirmedActionId, command.body.actionId)
    assert.equal(posts[1].body, posts[2].body)
    assert.equal(
      Number(
        (await f.db.query('SELECT count(*) AS total FROM monthly_actions WHERE career_id=$1', [id]))
          .rows[0].total,
      ),
      1,
    )
    const confirmed = state!.workspace!.confirmedActionId!
    assert.equal(
      await controller.send({
        kind: 'advance',
        careerId: id,
        body: { commandId: randomUUID(), actionId: confirmed, expectedTurn: 1 },
      }),
      true,
    )
    assert.equal(state!.workspace!.career!.state.careerTurnIndex, 2)
    assert.equal(state!.workspace!.confirmedActionId, null)
    // Replaying the old action now returns a turn-1 receipt. The visible state must stay on turn 2.
    journal.write(JSON.stringify(command))
    assert.equal(await controller.refresh(), true)
    assert.equal(state!.workspace!.career!.state.careerTurnIndex, 2)
    const revision = state!.workspace!.career!.revision
    assert.equal(
      await controller.send({
        kind: 'retire',
        careerId: id,
        body: { commandId: randomUUID(), expectedRevision: revision },
      }),
      true,
    )
    assert.equal(state!.workspace!.career, null)
    const projection = serverLifecycle(state!.workspace!)
    assert.equal(projection.activeHorse, null)
    assert.equal(projection.archive[0].id, id)
    assert.equal(projection.archive[0].retiredAt, '2028.05')
    const nextId = randomUUID()
    assert.equal(
      await controller.send({
        kind: 'create',
        body: { careerId: nextId, horseDefinitionId: 'DEV_HORSE_SERENE_STEP' },
      }),
      true,
    )
    assert.equal(state!.workspace!.career!.state.calendarDate.month, 5)
    journal.write(JSON.stringify(command))
    assert.equal(await controller.refresh(), true)
    assert.equal(state!.workspace!.career!.id, nextId)
    assert.equal(state!.workspace!.retirements[0].snapshot.status, 'retired')
    // Definitive conflict refreshes authority and clears only the rejected command.
    assert.equal(
      await controller.send({
        kind: 'action',
        careerId: nextId,
        body: { actionId: randomUUID(), choice: 'rest', expectedTurn: 9 },
      }),
      false,
    )
    assert.equal(state!.pending, false, state!.error ?? undefined)
    assert.equal(state!.workspace!.career!.state.careerTurnIndex, 1)
  } finally {
    await f.close()
  }
})

test('server result events restore separately from browser fixtures and block advance until chosen', async () => {
  const f = await fixture({ probability: 1, share: 0 })
  try {
    const event = convertNotionRows((await catalogSource()).rows).events.find(
      (e) => e.id === 'COM-0034',
    )!
    const { revision: _revision, ...definition } = event
    definition.timing = 'training_result'
    definition.choices = definition.choices.map((c) => ({
      ...c,
      effects: [{ type: 'value_delta', key: 'fatigue', amount: -1 }],
    }))
    await importEvents(f.db, {
      schemaVersion: 1,
      events: [{ ...definition, revision: digest(definition) }],
    })
    await f.db.query("UPDATE event_definitions SET enabled=(id='COM-0034')")
    const api = createApiClient({
      baseUrl: 'http://api',
      getSessionToken: () => f.user.token,
      fetch: async (input, init) => {
        const url = new URL(String(input))
        const response = await f.app.inject({
          method: init?.method === 'POST' ? 'POST' : 'GET',
          url: url.pathname + url.search,
          headers: headersObject(init?.headers),
          payload: init?.body as string | undefined,
        })
        return new Response(response.body, { status: response.statusCode })
      },
    })
    let saved: string | null = null
    let state: SaveSnapshot | undefined
    const controller = new ServerSaveController(
      api,
      {
        read: () => saved,
        write: (value) => {
          saved = value
        },
        clear: () => {
          saved = null
        },
      },
      (next) => {
        state = next
      },
    )
    const id = randomUUID()
    assert.equal(
      await controller.send({
        kind: 'create',
        body: { careerId: id, horseDefinitionId: 'DEV_HORSE_SERENE_STEP' },
      }),
      true,
    )
    assert.equal(
      await controller.send({
        kind: 'action',
        careerId: id,
        body: { actionId: randomUUID(), choice: 'speed', expectedTurn: 1 },
      }),
      true,
    )
    const career = state!.workspace!.career!
    assert.equal(career.state.event, undefined)
    assert.equal(career.event!.state, 'pending')
    assert.equal(
      await controller.send({
        kind: 'advance',
        careerId: id,
        body: {
          commandId: randomUUID(),
          actionId: state!.workspace!.confirmedActionId!,
          expectedTurn: 1,
        },
      }),
      false,
    )
    assert.equal(state!.workspace!.career!.state.careerTurnIndex, 1)
    assert.equal(
      await controller.send({
        kind: 'event',
        careerId: id,
        historyId: career.event!.id,
        body: { commandId: randomUUID(), choiceId: 'B', expectedTurn: 1 },
      }),
      true,
    )
    assert.equal(state!.workspace!.career!.event!.state, 'applied')
    assert.equal(
      await controller.send({
        kind: 'advance',
        careerId: id,
        body: {
          commandId: randomUUID(),
          actionId: state!.workspace!.confirmedActionId!,
          expectedTurn: 1,
        },
      }),
      true,
    )
  } finally {
    await f.close()
  }
})
