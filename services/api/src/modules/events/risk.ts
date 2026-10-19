import { hashSeed } from '../../../../../packages/shared/src/domain'
import {
  RISK_WEIGHTS,
  riskOutcomes,
  type EventChoice,
  type RiskOutcome,
} from '../../../../../packages/shared/src/events'

/** The draw seed and immutable definition revision lock the roll; no request ID or clock is used. */
export function resolveEventChoice(choice: EventChoice, seed: string, revision: string) {
  if (!choice.risk) {
    return { effects: choice.effects }
  }
  let target = (hashSeed(`${seed}:${revision}:${choice.id}:event-risk-v1`) / 4294967296) * 100
  let outcome: RiskOutcome = 'disaster'
  for (const candidate of riskOutcomes) {
    target -= RISK_WEIGHTS[candidate]
    if (target < 0) {
      outcome = candidate
      break
    }
  }
  return { effects: choice.risk.outcomes[outcome], risk: { version: choice.risk.version, outcome } }
}
