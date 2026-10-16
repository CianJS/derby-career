import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArchivedHorseRecord } from '../components/career/horse-record'
import { Stable } from '../components/career/stable'
import { Races } from '../components/career/race-catalog'
import { Jockeys } from '../components/career/jockey-record'
import { Sidebar } from '../components/career/navigation'
import type { CareerHorse } from '../components/career/legacy-types'

const horse: CareerHorse = {
  id: 'archived-career',
  name: '보존된 경주마',
  age: '4세',
  sex: '수말',
  growth: '표준',
  growthNote: '',
  stats: [['속도', 621]],
  aptitude: [['마장', '잔디', 'A']],
  record: '1전 1승',
  best: '1착',
  prize: '₩42,000,000',
  retiredAt: '2028.04',
  raceRecords: [
    {
      race: '저장된 경주',
      result: '1착',
      date: '2028.03',
      raceRunId: 'saved-run',
      jockeyId: 'HAN_DOYUN',
      jockeyName: '한도윤',
      placing: 1,
      distance: 1600,
      grade: 'G3',
      prizeMoney: 42000000,
    },
  ],
}
const setView = () => {}

test('management archive renders saved statistics and race history without substitute results', () => {
  const markup = renderToStaticMarkup(createElement(ArchivedHorseRecord, { horse, setView }))
  for (const text of [
    '보존된 경주마',
    '621',
    '잔디',
    '2028.04',
    '저장된 경주',
    '1600m',
    '한도윤',
    '42,000,000',
    '1착',
  ]) {
    assert.ok(markup.includes(text), text)
  }
  assert.doesNotMatch(markup, /출전 기록이 없습니다/)
  assert.equal(horse.raceRecords?.length, 1)
})

test('empty stable and horse history preserve their empty states', () => {
  const stable = renderToStaticMarkup(createElement(Stable, { archive: [], setView }))
  assert.match(stable, /아직 기록된 경주마가 없습니다/)
  assert.doesNotMatch(stable, /보존된 경주마/)
  const archive = renderToStaticMarkup(
    createElement(ArchivedHorseRecord, {
      horse: { ...horse, raceRecords: [] },
      setView,
    }),
  )
  assert.match(archive, /출전 기록이 없습니다/)
  assert.match(archive, /함께한 기수 기록이 없습니다/)
})

test('race catalog waits for public API and jockey catalog retains its entries', () => {
  const races = renderToStaticMarkup(createElement(Races, { setView }))
  assert.match(races, /공개 경주 카탈로그 조회 중/)
  assert.doesNotMatch(races, /한신 컵|사츠키상|NHK 마일컵|오사카배/)
  const jockeys = renderToStaticMarkup(createElement(Jockeys, { setView, onSelect: () => {} }))
  assert.match(jockeys, /계약 기수 3 \/ 3/)
  assert.match(jockeys, /data-trust-status="loading"/)
  assert.doesNotMatch(jockeys, /0 \/ 100|현재 육성마 없음/)
})

test('archive detail keeps the stable navigation item selected', () => {
  const markup = renderToStaticMarkup(createElement(Sidebar, { view: 'horseArchive', setView }))
  assert.match(markup, /text-foreground[^>]*>.*?마구간/)
})
