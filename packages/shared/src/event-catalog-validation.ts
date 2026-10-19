import { validateEventDefinition, validateEventList } from './generated/event-validation.mjs'
import { publicEventDefinition } from './events'

export function parseCatalogEvent(value: unknown) {
  if (!validateEventDefinition(value)) {
    throw new Error('이벤트 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.')
  }
  return publicEventDefinition(value)
}

export function parseCatalogPage(value: unknown) {
  if (!validateEventList(value)) {
    throw new Error('이벤트 목록 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.')
  }
  return { ...value, data: value.data.map(publicEventDefinition) }
}
