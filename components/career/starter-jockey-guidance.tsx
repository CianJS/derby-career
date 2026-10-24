import {
  jockeyCatalog,
  starterJockeyOptions,
  type Horse,
  type StarterJockeyId,
  type RunningTactic,
} from '@/packages/shared/src/domain'

export const tacticDescriptions: Record<RunningTactic, string> = {
  도주: '초반부터 선두에 나서 앞에서 경주를 이끄는 전술입니다.',
  선행: '선두 바로 뒤의 앞쪽 위치를 유지하다 승부를 거는 전술입니다.',
  선입: '중간권에서 흐름을 살피고 앞선 말을 추격하는 전술입니다.',
  추입: '뒤쪽에서 힘을 아끼다가 후반에 앞선 말을 추격하는 전술입니다.',
}

export const jockeyAbilities = [
  { key: 'start', label: '스타트', description: '출발 반응과 초반 가속에 관여합니다.' },
  {
    key: 'pace',
    label: '페이스 판단',
    description: '경주 흐름에 맞춰 전술을 수행하는 안정성에 관여합니다.',
  },
  {
    key: 'path',
    label: '진로 판단',
    description: '앞이 막힐 때 반응하고 진로를 조정하는 데 관여합니다.',
  },
  {
    key: 'timing',
    label: '승부 타이밍',
    description: '막판 스퍼트와 가속을 펼치는 데 관여합니다.',
  },
  {
    key: 'stability',
    label: '기승 안정',
    description: '선택한 전술을 흔들림 없이 수행하는 데 관여합니다.',
  },
] as const

export function starterJockey(id?: StarterJockeyId) {
  const option = starterJockeyOptions.find((entry) => entry.jockeyId === id)
  const jockey = jockeyCatalog.find((entry) => entry.id === option?.jockeyId)
  return option && jockey ? { ...option, jockey } : null
}

export function starterComparison(id: StarterJockeyId) {
  const selected = starterJockey(id)
  if (!selected) {
    return null
  }
  const candidates = starterJockeyOptions.map((option) => starterJockey(option.jockeyId)!.jockey)
  const comparisons = jockeyAbilities.map((ability) => ({
    ...ability,
    value: selected.jockey[ability.key],
    highest: Math.max(...candidates.map((jockey) => jockey[ability.key])),
  }))
  const strengths = comparisons.filter((ability) => ability.value === ability.highest)
  const attention = [...comparisons].sort((a, b) => b.highest - b.value - (a.highest - a.value))[0]
  return `초기 후보 중 ${strengths.map((ability) => `${ability.label} ${ability.value}`).join('·')}이 가장 높습니다. ${attention.label} ${attention.value}은 후보 중 최고 ${attention.highest}보다 낮으므로 함께 비교해 주세요.`
}

/** Only real candidate aptitude is described; no race, fit score or result is projected. */
export function starterCombination(id: StarterJockeyId, aptitude?: Horse['aptitude']) {
  const selected = starterJockey(id)
  if (!selected) {
    return null
  }
  const grade = aptitude?.find(([tactic]) => tactic === selected.specialty)?.[1]
  const guidance =
    grade === 'A'
      ? '해당 전술 적성이 높아 조합을 검토할 만합니다.'
      : grade === 'B'
        ? '해당 전술 적성이 양호해 조합을 검토할 수 있습니다.'
        : grade === 'C' || grade === 'D'
          ? '해당 전술 적성이 낮으므로 유의하세요. 다른 전술도 함께 검토해 주세요.'
          : '적성 확인 불가 · 해당 전술의 적성 정보가 없습니다.'
  return { ...selected, grade: ['A', 'B', 'C', 'D'].includes(grade ?? '') ? grade : null, guidance }
}

export function StarterCombination({
  id,
  horse,
}: {
  id: StarterJockeyId
  horse: Pick<Horse, 'name' | 'aptitude'>
}) {
  const combination = starterCombination(id, horse.aptitude)
  return combination ? (
    <div className="rounded border border-border p-3 text-xs" data-starter-combination>
      <p className="font-semibold">
        {horse.name} · {combination.jockey.name} · {combination.specialty} 특화 · 전술 적성{' '}
        {combination.grade ?? '확인 불가'}
      </p>
      <p className="mt-2 text-muted-foreground">{combination.guidance}</p>
    </div>
  ) : null
}
