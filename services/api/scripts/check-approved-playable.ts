import { readFile } from 'node:fs/promises'
import { normalizeRacingCatalog } from '../src/modules/racing/catalog'
import { deriveApprovedPlayable } from '../src/modules/racing/mapping-release'

export async function checkApprovedPlayable() {
  const source = JSON.parse(await readFile('seeds/racing.notion.source.json', 'utf8'))
  const catalog = normalizeRacingCatalog(source)
  const approvals = JSON.parse(await readFile('config/approved-race-mappings.json', 'utf8'))
  const expected =
    JSON.stringify(deriveApprovedPlayable(approvals, catalog.races, catalog.courses), null, 2) +
    '\n'
  const actual = await readFile('../../packages/shared/src/approved-playable.json', 'utf8')
  if (actual !== expected) {
    throw new Error('Approved playable registry is stale or contains unverified records')
  }
}
