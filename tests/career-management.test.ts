import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArchivedHorseRecord } from '../components/career/horse-record'
import { Stable, StableActiveHorse, stableActiveState } from '../components/career/stable'
import type { careerStore } from '../lib/career/store'
import { legacyCareer } from './helpers/legacy-career'
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

test('stable active projection uses the current saved career and suppresses stale summaries during uncertain states', () => {
  const career = {
    ...legacyCareer('DEV_HORSE_SERENE_STEP'),
    age: 7,
    month: 61,
    careerTurnIndex: 61,
    raceRecords: horse.raceRecords!,
  }
  const snapshot: ReturnType<typeof careerStore.getSnapshot> = {
    mode: 'local',
    ready: true,
    busy: false,
    pending: false,
    error: null,
    career,
    workspace: null,
    raceOptions: null,
    candidates: [],
    localCareerId: 'current-career',
    lifecycle: { archive: [horse] },
  }
  const before = JSON.stringify(snapshot)
  const active = stableActiveState(snapshot, 'local', horse)
  const markup = renderToStaticMarkup(
    createElement(StableActiveHorse, { active, setView, onActiveSelect: () => {} }),
  )
  assert.match(markup, /세레네 스텝/)
  assert.match(markup, /7세/)
  assert.match(markup, /61턴/)
  assert.match(markup, /6년 차/)
  assert.match(markup, /1전 1승/)
  assert.match(markup, /₩42,000,000/)
  assert.match(markup, /육성 계속|현역마 세레네 스텝 상세 보기/)
  assert.doesNotMatch(markup, /보존된 경주마|data-archive-id/)
  for (const state of [
    stableActiveState(snapshot, 'server', horse),
    stableActiveState({ ...snapshot, ready: false }, 'local', horse),
    stableActiveState({ ...snapshot, busy: true }, 'local', horse),
    stableActiveState({ ...snapshot, pending: true }, 'local', horse),
    stableActiveState({ ...snapshot, error: '저장 실패' }, 'local', horse),
    stableActiveState(snapshot, 'local', horse, false, '마방 읽기 실패'),
  ]) {
    assert.equal(state.horse, null)
    assert.doesNotMatch(state.message, /육성 중인 경주마가 없습니다/)
  }
  const retired = stableActiveState({ ...snapshot, career: null }, 'local', horse)
  assert.equal(retired.status, 'empty')
  assert.equal(retired.horse, null)
  const next = stableActiveState(
    {
      ...snapshot,
      career: { ...career, horse: { ...career.horse, name: '다음 육성' }, raceRecords: [] },
    },
    'local',
    horse,
  )
  assert.equal(next.horse?.name, '다음 육성')
  assert.equal(next.horse?.record, '0전 0승')
  assert.equal(next.horse?.prize, '₩0')
  assert.equal(JSON.stringify(snapshot), before)
})

test('management archive renders saved statistics and race history without substitute results', () => {
  const markup = renderToStaticMarkup(createElement(ArchivedHorseRecord, { horse, setView }))
  for (const text of [
    '보존된 경주마',
    '4세',
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
  assert.equal(horse.age, '4세')
})

test('empty stable and horse history preserve their empty states', () => {
  const stable = renderToStaticMarkup(createElement(Stable, { archive: [], setView }))
  assert.match(stable, /저장 모드를 확인|불러오는 중/)
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

test('race catalog waits for public API and jockey UI never invents contracts', () => {
  const races = renderToStaticMarkup(createElement(Races, { setView, onGameplay: () => {} }))
  assert.match(races, /공개 경주 카탈로그 조회 중/)
  assert.doesNotMatch(races, /한신 컵|사츠키상|NHK 마일컵|오사카배/)
  const jockeys = renderToStaticMarkup(createElement(Jockeys, { setView, onSelect: () => {} }))
  assert.match(jockeys, /계약 기수 확인 중/)
  assert.doesNotMatch(jockeys, /최대 3명|계약 가능|한도윤|서지안|윤태성/)
  assert.doesNotMatch(jockeys, /0 \/ 100|현재 육성마 없음/)
})

test('archive detail keeps the stable navigation item selected', () => {
  const markup = renderToStaticMarkup(createElement(Sidebar, { view: 'horseArchive', setView }))
  assert.match(markup, /text-foreground[^>]*>.*?마구간/)
})
