import test from 'node:test'
import assert from 'node:assert/strict'
import { GET } from '../app/api/events/route'

test('static event query accepts only owned kind keys, including when a key names an object prototype', async () => {
  for (const kind of ['toString', 'constructor', '__proto__']) {
    assert.equal(
      (await GET(new Request(`http://frontend.test/api/events?kind=${kind}`))).status,
      400,
    )
  }
  const response = await GET(
    new Request('http://frontend.test/api/events?kind=focus&timing=month-start'),
  )
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.ok(body.events.length > 0)
  assert.ok(
    body.events.every(
      (event: { kind: string; timing: string }) =>
        event.kind === 'focus' && event.timing === 'month-start',
    ),
  )
})
