import type { components } from '../../packages/shared/src/generated/api'
import { validateCareerWorkspace } from '../../packages/shared/src/generated/save-validation.mjs'
import { assertCareer, type Career } from '../career/model'

type Models = components['schemas']
type ServerCareer = Models['Career'] & { state: Career }
export type SaveWorkspace = Omit<Models['CareerWorkspace'], 'career' | 'retirements'> & {
  career: ServerCareer | null
  retirements: (Models['RetirementRecord'] & { snapshot: ServerCareer })[]
}

function assertSaveWorkspace(value: unknown): asserts value is SaveWorkspace {
  if (!validateCareerWorkspace(value)) {
    throw new Error('서버 저장 응답이 계약과 다릅니다. 다시 불러와 주세요.')
  }
  if (value.career) {
    assertCareer(value.career.state)
    if (value.career.status !== 'active' || value.career.stableId !== value.stable?.id) {
      throw new Error('서버의 현재 육성 상태를 확인하지 못했습니다.')
    }
  }
  for (const record of value.retirements) {
    assertCareer(record.snapshot.state)
    if (record.snapshot.status !== 'retired' || record.snapshot.id !== record.careerId) {
      throw new Error('서버 은퇴 기록을 확인하지 못했습니다.')
    }
  }
}

export function parseSaveWorkspace(value: unknown): SaveWorkspace {
  assertSaveWorkspace(value)
  return value
}
