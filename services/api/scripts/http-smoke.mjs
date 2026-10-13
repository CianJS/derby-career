import assert from 'node:assert/strict'
const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000'
const ready = await fetch(base + '/health/ready')
assert.equal(ready.status, 200)
assert.equal((await ready.json()).status, 'ready')
const events = await fetch(base + '/v1/events?category=common&enabled=true&pageSize=5')
assert.equal(events.status, 200)
const catalog = await events.json()
assert.equal(catalog.pagination.total, 315)
assert.equal(catalog.data.length, 5)
const privateRead = await fetch(base + '/v1/careers')
assert.equal(privateRead.status, 503)
assert.equal((await privateRead.json()).error.code, 'AUTH_NOT_CONFIGURED')
console.log('HTTP -> PostgreSQL -> event catalog verified; private production API is disabled')
