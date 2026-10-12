import { labels } from '../model'
import type { EventChoice, EventDefinition, EventEffect, EventScope } from './types'

const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`
const scopeText = (scope: EventScope) => scope === 'immediate' ? '즉시' : scope === 'training' ? '이번 달 훈련' : scope === 'rest' ? '이번 달 휴식' : `이번 달 ${labels[scope]} 훈련`

export function growthText(growth: NonNullable<EventEffect['growth']>): string {
  const parts: string[] = []
  if (growth.multiplier !== undefined) parts.push(`주성장 ×${growth.multiplier}`)
  if (growth.ratio !== undefined) parts.push(`주성장 추가 +${Math.round(growth.ratio * 100)}%`)
  if (growth.flat !== undefined) parts.push(`주성장 ${signed(growth.flat)}`)
  return parts.join(' · ')
}
/** Preview text generated from effect data, so no component spells out what an event does. */
export function effectText(effect: EventEffect): string {
  const parts: string[] = []
  if (effect.growth) parts.push(growthText(effect.growth))
  if (effect.fatigue !== undefined) parts.push(`피로 ${signed(effect.fatigue)}`)
  if (effect.bodyLoad !== undefined) parts.push(`신체 부하 ${signed(effect.bodyLoad)}`)
  return `${scopeText(effect.scope)} ${parts.join(' · ')}`
}
export const choiceText = (choice: EventChoice) => choice.effects.map(effectText).join(' / ')
export const eventPreview = (definition: EventDefinition): string[] => definition.choices ? definition.choices.map(choice => `${choice.id}. ${choiceText(choice)}`) : definition.effects.map(effectText)

export type FocusPreview = { stat: NonNullable<EventDefinition['condition']['trainingStat']>; growth: string; fatigue: number; bodyLoad: number }
/** The numbers a special-training comparison shows next to the plain training card. */
export function focusPreview(definition: EventDefinition): FocusPreview | null {
  const stat = definition.condition.trainingStat
  const effect = definition.effects[0]
  if (definition.kind !== 'focus' || !stat || !effect?.growth) return null
  return { stat, growth: growthText(effect.growth), fatigue: effect.fatigue ?? 0, bodyLoad: effect.bodyLoad ?? 0 }
}
