import type { components } from '@/packages/shared/src/generated/api'

type Models = components['schemas']
export type CatalogEvent = Models['EventDefinition']
export type CatalogPage = Models['EventList']

export const categoryLabels: Record<CatalogEvent['category'], string> = {
  common: '공통',
  normal: '일반',
  special: '특별',
  accident: '사고',
  hidden: '숨김',
}
export const statusLabels: Record<CatalogEvent['status'], string> = {
  ready: '준비 완료',
  needs_mapping: '효과 매핑 필요',
  deferred: '적용 보류',
}
export const timingLabels: Record<CatalogEvent['timing'], string> = {
  month_start: '월 시작',
  training_result: '훈련 결과',
  rest_result: '휴식 결과',
  treatment_result: '치료 결과',
  before_race: '경주 전',
  after_race: '경주 후',
}
const valueLabels = {
  speed: '속도',
  stamina: '지구력',
  power: '파워',
  guts: '근성',
  intelligence: '지능',
  fatigue: '피로',
  bodyLoad: '신체 부하',
}
const choiceLabels = { ...valueLabels, rest: '휴식', treatment: '치료' }
const fieldLabels = {
  primaryGain: '주성장량',
  secondaryGain: '보조 성장량',
  fatigue: '피로 변화량',
  bodyLoad: '신체 부하 변화량',
}
const signed = (value: number) => (value > 0 ? `+${value}` : String(value))

export function conditionText(condition: Models['EventCondition']): string {
  switch (condition.type) {
    case 'aptitude_any':
      return `${condition.names.join(' 또는 ')} 적성: ${condition.grades.join('/')}`
    case 'growth_is':
      return `성장형: ${condition.growth}`
    case 'health_is':
      return `건강: ${condition.health.join(' 또는 ')}`
    case 'record_range':
      return `${condition.metric === 'wins' ? '승리' : '출전'}: ${condition.min ?? 0} ~ ${condition.max ?? '제한 없음'}`
    case 'stat_summary':
      return `${condition.metric === 'spread' ? '최고/최저 능력 차이' : `능력 ${condition.threshold} 이상인 개수`}: ${condition.min ?? 0} ~ ${condition.max ?? '제한 없음'}`
    case 'always':
      return '별도 조건 없음'
    case 'healthy':
      return '건강 상태가 정상일 때'
    case 'training_available':
      return `${valueLabels[condition.stat]} 훈련이 가능할 때`
    case 'action_is':
      return `선택 행동: ${condition.choices.map((choice) => choiceLabels[choice]).join(', ')}`
    case 'value_range':
      return `${valueLabels[condition.key]}: ${condition.min ?? '제한 없음'} ~ ${condition.max ?? '제한 없음'}`
    case 'turn_range':
      return `육성 ${condition.min ?? 1}개월 ~ ${condition.max ?? '마지막'}개월`
  }
}

export function effectText(effect: Models['EventEffect']): string {
  switch (effect.type) {
    case 'value_delta':
      return `${valueLabels[effect.key]} ${signed(effect.amount)}`
    case 'resolved_growth_bonus':
      return `확정된 ${valueLabels[effect.stat]} 주성장량의 ${Math.round(effect.ratio * 100)}% 추가`
    case 'action_modifier': {
      const action =
        effect.action === 'training'
          ? effect.training
            ? `${valueLabels[effect.training]} 훈련`
            : '훈련'
          : choiceLabels[effect.action]
      const amount = effect.operation === 'multiply' ? `×${effect.value}` : signed(effect.value)
      return `${action} ${fieldLabels[effect.field]} ${amount}`
    }
  }
}
