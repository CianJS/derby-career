import { readFile } from 'node:fs/promises'
import { normalizeRacingCatalog } from '../src/modules/racing/catalog'
import {
  deriveApprovedPlayable,
  deriveApprovedHistory,
} from '../src/modules/racing/mapping-release'

export async function checkApprovedPlayable() {
  const source = JSON.parse(await readFile('seeds/racing.notion.source.json', 'utf8'))
  const catalog = normalizeRacingCatalog(source)
  const approvals = JSON.parse(await readFile('config/approved-race-mappings.json', 'utf8'))
  const historical = JSON.parse(await readFile('config/approved-race-history.json', 'utf8'))
  const archive = deriveApprovedHistory(historical)
  const active = deriveApprovedPlayable(approvals, catalog.races, catalog.courses)
  if (
    active.some((entry) => !archive.some((old) => JSON.stringify(old) === JSON.stringify(entry)))
  ) {
    throw new Error('Every active approval must also be retained in the historical registry')
  }
  const actualHistory = await readFile(
    '../../packages/shared/src/approved-playable-history.json',
    'utf8',
  )
  if (actualHistory !== JSON.stringify(archive, null, 2) + '\n') {
    throw new Error('Historical approved playable registry is stale or contains unverified records')
  }
  const expected = JSON.stringify(active, null, 2) + '\n'
  const actual = await readFile('../../packages/shared/src/approved-playable.json', 'utf8')
  if (actual !== expected) {
    throw new Error('Approved playable registry is stale or contains unverified records')
  }
}
