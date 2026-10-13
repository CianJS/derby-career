import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFeedTimeline, feedAt } from '../lib/career/race-feed'
import { buildFixture } from '../lib/career/fixtures'

test('one immutable race timeline supports repeated playback reads without revealing future events', () => {
  const fixture = buildFixture('playback-12')
  assert.ok(fixture.log && fixture.career?.raceRun)
  const names = new Map(
    fixture.career.raceRun.runners.map((runner) => [
      runner.horseSnapshot.id,
      runner.horseSnapshot.name,
    ]),
  )
  const timeline = buildFeedTimeline(fixture.log, names)
  const original = JSON.stringify(timeline)
  for (let time = 0; time <= fixture.log.durationMs; time += 500) {
    const feed = feedAt(timeline, time)
    assert.ok(feed.length <= 4)
    assert.ok(feed.every((item) => item.tMs <= time))
    assert.deepEqual(feed, feedAt(timeline, time))
    assert.ok(feed.every((item, index) => index === 0 || item.tMs <= feed[index - 1].tMs))
  }
  assert.equal(JSON.stringify(timeline), original)
  assert.deepEqual(feedAt(timeline, -1), [])
})
