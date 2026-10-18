import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture } from '../services/api/tests/helpers'
import { createApiClient } from '../packages/shared/src/client'
import { ServerSaveController, type SaveSnapshot } from '../lib/server-save/controller'
import { handleServerSave } from '../lib/server-save/bridge'

for (const targetCountry of ['JPN', 'USA'] as const) {
  test(`Frontend bridge ${targetCountry}: original journal retry, revision conflict, authoritative travel and locked return`, async () => {
    const f = await fixture()
    try {
      let journal: string | null = null
      let state!: SaveSnapshot
      let lose = false
      const requests: string[] = []
      const api = createApiClient({
        baseUrl: 'http://localhost:3000/api/server-save',
        fetch: async (input, init) => {
          return handleServerSave(
            new Request(String(input), {
              ...init,
              headers: {
                ...(init?.headers as Record<string, string>),
                ...(init?.method === 'POST' ? { Origin: 'http://localhost:3000' } : {}),
              },
            }),
            {
              NODE_ENV: 'development',
              DERBY_SAVE_MODE: 'server',
              DERBY_SERVER_SAVE_LOCAL: '1',
              DERBY_API_DEV_SESSION_TOKEN: f.user.token,
            },
            async (input, init) => {
              const url = new URL(String(input))
              const body = init?.body ? JSON.parse(String(init.body)) : undefined
              const res = await f.app.inject({
                method: init?.method as 'POST' | 'GET',
                url: url.pathname + url.search,
                payload: body,
                headers: { authorization: (init?.headers as Record<string, string>).Authorization },
              })
              if (url.pathname.endsWith('/expeditions')) {
                requests.push(JSON.stringify(body))
                if (lose) {
                  lose = false
                  throw new Error('lost response after commit')
                }
              }
              return new Response(res.body, {
                status: res.statusCode,
                headers: { 'Content-Type': 'application/json' },
              })
            },
          )
        },
      })
      const controller = new ServerSaveController(
        api,
        {
          read: () => journal,
          write: (v) => {
            journal = v
          },
          clear: () => {
            journal = null
          },
        },
        (value) => {
          state = value
        },
      )
      assert.equal(
        await controller.send({
          kind: 'create',
          body: {
            careerId: randomUUID(),
            horseDefinitionId: 'DEV_HORSE_RED_COMET',
            homeCountry: 'KOR',
          },
        }),
        true,
      )
      const current = () => state.workspace!.career!
      const settleEvent = async () => {
        const event = current().event
        if (event?.state === 'pending') {
          assert.equal(
            await controller.send({
              kind: 'event',
              careerId: current().id,
              historyId: event.id,
              body: {
                commandId: randomUUID(),
                choiceId: event.definition.choices[0].id,
                expectedTurn: current().state.careerTurnIndex,
              },
            }),
            true,
          )
        }
      }
      for (let turn = 1; turn < 3; turn++) {
        await settleEvent()
        assert.equal(
          await controller.send({
            kind: 'action',
            careerId: current().id,
            body: { actionId: randomUUID(), choice: 'rest', expectedTurn: turn },
          }),
          true,
        )
        await settleEvent()
        assert.equal(
          await controller.send({
            kind: 'advance',
            careerId: current().id,
            body: {
              commandId: randomUUID(),
              actionId: state.workspace!.confirmedActionId!,
              expectedTurn: turn,
            },
          }),
          true,
        )
      }
      await settleEvent()
      const id = current().id
      const funds = state.workspace!.stable!.funds
      const command = {
        kind: 'expedition-start',
        careerId: id,
        body: {
          commandId: randomUUID(),
          targetCountry,
          expectedTravelRevision: 0,
          raceDefinitionId: `DEV_${targetCountry}_M3_MILE_1600`,
        },
      } as const
      lose = true
      assert.equal(await controller.send(command), false)
      assert.ok(journal)
      assert.equal(state.pending, true)
      assert.equal(await controller.refresh(), true)
      assert.equal(requests.length, 2)
      assert.equal(requests[0], requests[1])
      assert.equal(journal, null)
      const travel = current().travel!
      assert.equal(travel.locationCountry, targetCountry)
      assert.equal(state.workspace!.stable!.funds, funds)
      assert.equal(current().state.careerTurnIndex, 3)
      assert.equal(
        await controller.send({
          ...command,
          body: {
            ...command.body,
            commandId: randomUUID(),
            targetCountry: targetCountry === 'JPN' ? 'USA' : 'JPN',
            expectedTravelRevision: 0,
          },
        }),
        false,
      )
      assert.equal(state.pending, false)
      assert.equal(current().travel!.revision, 1)
      assert.equal(
        await controller.send({
          kind: 'race-entry',
          careerId: id,
          body: {
            raceRunId: randomUUID(),
            raceDefinitionId: 'DEV_M3_MILE_1600',
            jockeyId: 'HAN_DOYUN',
            tactic: '선행',
            expectedTurn: 3,
            engineVersion: 'race-sim-v4',
          },
        }),
        false,
      )
      assert.equal(
        await controller.send({
          kind: 'race-entry',
          careerId: id,
          body: {
            raceRunId: randomUUID(),
            raceDefinitionId: command.body.raceDefinitionId,
            jockeyId: 'HAN_DOYUN',
            tactic: '선행',
            expectedTurn: 3,
            engineVersion: 'race-sim-v4',
          },
        }),
        true,
      )
      const run = current().state.raceRun!
      assert.equal(
        await controller.send({
          kind: 'expedition-return',
          careerId: id,
          expeditionId: travel.activeExpedition!.id,
          body: { commandId: randomUUID(), expectedTravelRevision: 1 },
        }),
        false,
      )
      assert.equal(
        await controller.send({
          kind: 'race-complete',
          careerId: id,
          raceRunId: run.raceRunId,
          body: { commandId: randomUUID() },
        }),
        true,
      )
      assert.equal(state.workspace!.stable!.funds, funds + run.simulation!.result.prizeMoney)
      assert.equal(
        await controller.send({
          kind: 'expedition-return',
          careerId: id,
          expeditionId: travel.activeExpedition!.id,
          body: { commandId: randomUUID(), expectedTravelRevision: 1 },
        }),
        true,
      )
      assert.equal(current().travel!.locationCountry, 'KOR')
      assert.equal(current().state.careerTurnIndex, 4)
      controller.dispose()
    } finally {
      await f.close()
    }
  })
}
