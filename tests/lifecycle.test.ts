import test from 'node:test'
import assert from 'node:assert/strict'
import { archiveActiveHorse } from '../lib/career/lifecycle'

test('retirement preserves each career with a unique archive ID and the current world month', () => {
  const horse = { id: 'DEV_HORSE_SERENE_STEP', name: '세레네 스텝', record: '3전 1승' }
  const initial = { activeHorse: horse, archive: [] as (typeof horse)[], year: 2029, month: 9 }
  const first = archiveActiveHorse(initial, horse.id, 'archive-first')
  assert.equal(first.activeHorse, null)
  assert.deepEqual(first.archive[0], { ...horse, id: 'archive-first', retiredAt: '2029.09' })
  const again = { ...first, activeHorse: { ...horse, record: '6전 2승' }, year: 2030, month: 1 }
  const second = archiveActiveHorse(again, horse.id, 'archive-second')
  assert.equal(second.archive.length, 2)
  assert.deepEqual(second.archive[0], {
    ...horse,
    record: '6전 2승',
    id: 'archive-second',
    retiredAt: '2030.01',
  })
  assert.equal(second.archive[1].id, 'archive-first')
  assert.equal(initial.activeHorse, horse)
})

test('retirement cannot duplicate an archive entry or remove a different active horse', () => {
  const state = {
    activeHorse: { id: 'active' },
    archive: [{ id: 'already-saved' }],
    year: 2029,
    month: 5,
  }
  assert.equal(archiveActiveHorse(state, 'different-horse', 'new'), state)
  assert.equal(archiveActiveHorse(state, 'active', 'already-saved'), state)
  const retired = archiveActiveHorse(state, 'active', 'new')
  assert.equal(archiveActiveHorse(retired, 'active', 'new'), retired)
})
