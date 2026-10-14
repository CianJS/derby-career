import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RetirementConfirm } from '../components/career/retirement-confirm'
import { STORAGE_ACCESS_MESSAGE } from '../lib/career/browser-save'

const props = {
  horseName: '레드 코멧',
  ready: true,
  busy: false,
  pending: false,
  error: null,
  blockedReason: null,
  local: true,
  onCancel: () => {},
  onConfirm: () => {},
  onRefresh: () => {},
  onContinue: () => {},
}
const render = (patch: Partial<Parameters<typeof RetirementConfirm>[0]> = {}) =>
  renderToStaticMarkup(createElement(RetirementConfirm, { ...props, ...patch }))

test('loaded retirement can be confirmed; loading and saving show status and disable confirmation', () => {
  assert.doesNotMatch(render(), /disabled=""/)
  const loading = render({ ready: false })
  assert.match(loading, /role="status"/)
  assert.match(loading, /육성 기록을 불러오는 중/)
  assert.match(loading, /disabled=""/)
  const saving = render({ busy: true })
  assert.match(saving, /aria-busy="true"/)
  assert.match(saving, /은퇴 저장 중/)
  assert.match(saving, /role="status"/)
})

test('retirement errors stay inside the confirmation with reload and local storage recovery', () => {
  const markup = render({ error: STORAGE_ACCESS_MESSAGE })
  assert.match(markup, /role="alert"/)
  assert.ok(markup.includes(STORAGE_ACCESS_MESSAGE))
  assert.match(markup, /다시 불러오기/)
  assert.match(markup, /target="_blank"/)
  assert.match(markup, /새 탭에서 열기/)
})

test('locked race cannot retire and offers continuation rather than a silent failed confirmation', () => {
  const markup = render({ blockedReason: '확정한 경주를 완료한 뒤 은퇴해 주세요.' })
  assert.match(markup, /확정한 경주를 완료한 뒤 은퇴/)
  assert.match(markup, /확정한 진행 이어가기/)
  assert.match(markup, /disabled=""/)
})

test('pending server retirement keeps confirmation disabled and offers the same-request retry', () => {
  const markup = render({ local: false, pending: true, error: '서버 응답을 확인하지 못했습니다.' })
  assert.match(markup, /role="alert"/)
  assert.match(markup, /같은 요청으로 다시 확인/)
  assert.match(markup, /disabled=""/)
  assert.doesNotMatch(markup, /새 탭에서 열기/)
})
