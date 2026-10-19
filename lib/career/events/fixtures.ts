import type { Stat } from '../model'
import type { EventChoice, EventDefinition, EventEffect } from './types'

/**
 * Initial common events, ids kept from the Notion event list. Everything an event does is an explicit field below,
 * so any row that differs from the Notion text, or a later DB-backed catalog, only has to change data here.
 */
type Cost = { fatigue?: number; bodyLoad?: number }

const focus = (id: string, name: string, description: string, stat: Stat, multiplier: number, cost: Cost): EventDefinition => ({
  id, name, description, kind: 'focus', timing: 'month-start', condition: { trainingStat: stat }, weight: 1, limitedToMonth: true,
  effects: [{ scope: stat, growth: { multiplier }, ...cost }],
})
const breakthrough = (id: string, name: string, description: string, stat: Stat, ratio: number, cost: Cost): EventDefinition => ({
  id, name, description, kind: 'breakthrough', timing: 'training-result', condition: { trainingStat: stat }, weight: 1, limitedToMonth: false,
  effects: [{ scope: stat, growth: { ratio }, ...cost }],
})
const recovery = (id: string, name: string, description: string, cost: Cost): EventDefinition => ({
  id, name, description, kind: 'recovery', timing: 'rest-result', condition: { action: 'rest' }, weight: 1, limitedToMonth: false,
  effects: [{ scope: 'rest', ...cost }],
})
const pick = (id: string, kind: 'discovery' | 'life', name: string, description: string, a: EventEffect, b: EventEffect): EventDefinition => {
  const choices: [EventChoice, EventChoice] = [{ id: 'A', effects: [a] }, { id: 'B', effects: [b] }]
  return { id, name, description, kind, timing: 'month-start', condition: {}, weight: 1, limitedToMonth: true, effects: [], choices }
}

export const EVENT_FIXTURES: readonly EventDefinition[] = [
  focus('COM-0001', '새벽 직선 주로', '이른 새벽, 막힘 없이 곧게 뻗은 주로가 비어 있습니다.', 'speed', 1.45, { fatigue: 5 }),
  focus('COM-0002', '오르막 집중 구간', '가파른 오르막을 쓸 수 있는 날입니다. 뒷다리에 힘이 실립니다.', 'power', 1.5, { bodyLoad: 7 }),
  focus('COM-0003', '일정한 호흡의 장거리', '호흡을 일정하게 맞춰 길게 달려 볼 수 있는 조건이 갖춰졌습니다.', 'stamina', 1.45, { fatigue: 7 }),
  focus('COM-0004', '막판 한 걸음 더', '끝까지 한 걸음을 더 내딛는 연습에 알맞은 흐름이 찾아왔습니다.', 'guts', 1.5, { fatigue: 7 }),
  focus('COM-0005', '전개 복기 수업', '지난 전개를 함께 되짚어 보며 판단을 다듬을 시간이 생겼습니다.', 'intelligence', 1.5, { fatigue: 2 }),
  focus('COM-0006', '넓게 열린 코너', '넓은 코너를 마음껏 돌며 재가속을 연습하기 좋은 날입니다.', 'power', 1.4, { bodyLoad: 5 }),
  focus('COM-0007', '리듬을 맞춘 인터벌', '달리고 쉬는 박자를 맞춘 인터벌 조교가 잘 맞아떨어집니다.', 'stamina', 1.4, { fatigue: 6 }),
  focus('COM-0008', '한적한 외곽 주로', '사람이 드문 외곽 주로에서 편하게 속도를 올릴 수 있습니다.', 'speed', 1.35, { bodyLoad: 3 }),
  focus('COM-0009', '짧은 재출발 반복', '멈췄다 다시 튀어 나가는 연습을 짧게 반복할 기회입니다.', 'power', 1.4, { fatigue: 4, bodyLoad: 4 }),
  focus('COM-0010', '후반 페이스 유지', '지친 구간에서도 페이스를 지켜 내는 연습에 알맞은 날입니다.', 'guts', 1.4, { fatigue: 6 }),

  breakthrough('COM-0016', '출발 감각이 살아난 날', '게이트가 열리는 순간의 반응이 유난히 가벼웠습니다.', 'speed', 0.45, { fatigue: 2 }),
  breakthrough('COM-0017', '힘을 아끼는 긴 호흡', '불필요한 힘을 빼고 끝까지 같은 호흡으로 달렸습니다.', 'stamina', 0.45, {}),
  breakthrough('COM-0018', '탄력적인 뒷다리 움직임', '뒷다리가 용수철처럼 튀어 올라 추진력이 한 단계 올랐습니다.', 'power', 0.45, { bodyLoad: 3 }),
  breakthrough('COM-0019', '끝까지 무너지지 않은 리듬', '힘든 구간에서도 리듬이 끝까지 흐트러지지 않았습니다.', 'guts', 0.45, { fatigue: 3 }),
  breakthrough('COM-0020', '낯선 흐름에도 침착하게', '예상과 다른 흐름에도 당황하지 않고 침착하게 대응했습니다.', 'intelligence', 0.5, {}),

  pick('COM-0031', 'discovery', '낡은 조교 노트', '마방 구석에서 오래된 조교 노트가 나왔습니다. 두 페이지가 눈에 띕니다.',
    { scope: 'intelligence', growth: { flat: 3 } }, { scope: 'guts', growth: { flat: 3 } }),
  pick('COM-0032', 'discovery', '바람의 방향', '오늘은 바람이 일정하게 붑니다. 어느 쪽을 활용할지 정해 보세요.',
    { scope: 'speed', growth: { flat: 3 } }, { scope: 'stamina', fatigue: -3 }),
  pick('COM-0033', 'discovery', '주로 관리인의 조언', '주로 관리인이 조교 요령을 한마디 건넸습니다.',
    { scope: 'power', growth: { flat: 3 } }, { scope: 'training', bodyLoad: -2 }),
  pick('COM-0034', 'discovery', '여유가 생긴 오후', '예정보다 일찍 일과가 끝나 한가한 오후가 생겼습니다.',
    { scope: 'immediate', fatigue: -3 }, { scope: 'training', fatigue: -3 }),
  pick('COM-0035', 'discovery', '새롭게 정리된 마방', '마방이 말끔히 정돈되어 지내기가 한결 편해졌습니다.',
    { scope: 'immediate', bodyLoad: -3 }, { scope: 'rest', bodyLoad: -4 }),

  recovery('COM-0046', '깊어진 숙면', '밤새 한 번도 깨지 않고 깊이 잠들었습니다.', { fatigue: -5 }),
  recovery('COM-0047', '가벼운 움직임', '쉬는 동안 가볍게 걸으며 몸이 풀렸습니다.', { bodyLoad: -4 }),
  recovery('COM-0048', '따뜻한 마방 공기', '마방 안 공기가 포근해 몸과 마음이 함께 풀렸습니다.', { fatigue: -3, bodyLoad: -2 }),
  recovery('COM-0049', '하루 종일 차분하게', '하루 내내 조용하고 차분하게 지나갔습니다.', { fatigue: -4 }),
  recovery('COM-0050', '균형 잡힌 먹이', '영양이 고르게 잡힌 먹이로 몸이 한결 가벼워졌습니다.', { bodyLoad: -3 }),

  pick('COM-0061', 'life', '마방의 작은 응원', '마방 식구들이 말을 향해 작은 응원을 보내 왔습니다.',
    { scope: 'training', growth: { flat: 2 } }, { scope: 'immediate', fatigue: -2 }),
  pick('COM-0062', 'life', '새 이웃의 등장', '옆 마방에 새 말이 들어왔습니다. 좋은 자극이 될지도 모릅니다.',
    { scope: 'intelligence', growth: { flat: 2 } }, { scope: 'immediate', bodyLoad: -2 }),
  pick('COM-0063', 'life', '익숙한 발소리', '매일 듣던 발소리가 들리자 말이 눈에 띄게 안정을 찾았습니다.',
    { scope: 'training', fatigue: -2 }, { scope: 'immediate', fatigue: -2 }),
  pick('COM-0064', 'life', '조교사의 작은 메모', '조교사가 남긴 짧은 메모가 마방 벽에 붙어 있습니다.',
    { scope: 'intelligence', growth: { flat: 3 } }, { scope: 'stamina', growth: { flat: 2 } }),
  pick('COM-0065', 'life', '깨끗해진 장비함', '장비함이 말끔히 정리되어 준비 시간이 줄었습니다.',
    { scope: 'power', bodyLoad: -2 }, { scope: 'immediate', bodyLoad: -2 }),
]
