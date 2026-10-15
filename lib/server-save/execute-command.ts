import type { DerbyApiClient } from '../../packages/shared/src/client'
import { validateSaveResponse } from '../../packages/shared/src/save-response-validation'
import type { SaveCommand } from './commands'

/** Sends the original request and checks its receipt; journal lifetime belongs to the controller. */
export async function executeSaveCommand(api: DerbyApiClient, command: SaveCommand): Promise<void> {
  let result: unknown
  switch (command.kind) {
    case 'create':
      result = await api.createCareer(command.body)
      break
    case 'action':
      result = await api.confirmAction(command.careerId, command.body)
      break
    case 'advance':
      result = await api.advanceMonth(command.careerId, command.body)
      break
    case 'event':
      result = await api.chooseEvent(command.careerId, command.historyId, command.body)
      break
    case 'retire':
      result = await api.retireCareer(command.careerId, command.body)
      break
    case 'race-entry':
      result = await api.enterRace(command.careerId, command.body)
      break
    case 'race-complete':
      result = await api.completeRace(command.careerId, command.raceRunId, command.body)
      break
  }
  if (!validateSaveResponse(command.kind, result)) {
    throw new Error('저장 응답을 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.')
  }
  // Receipts may replay historical state; the controller must still read the latest workspace.
}
