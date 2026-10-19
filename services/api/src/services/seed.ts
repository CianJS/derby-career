import { expeditionFixtures } from './expedition-fixtures'
import { readFile } from 'node:fs/promises'
import { horses, jockeyCatalog, raceDefinitions } from '../../../../packages/shared/src/domain'
import { importEvents } from '../modules/events/import'
import { importExpansion } from '../modules/events/expansion'
import type { Database } from '../db'

export async function seedDevelopmentCatalog(db: Database, includeExpansion = true) {
  await db.transaction(async (tx) => {
    for (const horse of horses) {
      await tx.query(
        "INSERT INTO horse_definitions(id,payload,source_kind) VALUES($1,$2,'development_fixture') ON CONFLICT DO NOTHING",
        [horse.id, JSON.stringify(horse)],
      )
      for (const [name, grade] of horse.aptitude) {
        await tx.query(
          'INSERT INTO horse_aptitudes(horse_definition_id,aptitude,grade) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [horse.id, name, grade],
        )
      }
    }
    for (const jockey of jockeyCatalog) {
      await tx.query(
        "INSERT INTO jockey_definitions(id,payload,source_kind) VALUES($1,$2,'development_fixture') ON CONFLICT DO NOTHING",
        [jockey.id, JSON.stringify(jockey)],
      )
    }
    for (const race of [...raceDefinitions, ...expeditionFixtures]) {
      await tx.query(
        "INSERT INTO race_definitions(id,payload,source_kind,country_code) VALUES($1,$2,'development_fixture',$3) ON CONFLICT DO NOTHING",
        [race.id, JSON.stringify(race), race.countryCode ?? 'KOR'],
      )
    }
  })
  const legacy = await importEvents(
    db,
    JSON.parse(await readFile('seeds/events.catalog.json', 'utf8')),
  )
  const expansion = includeExpansion
    ? await importExpansion(
        db,
        JSON.parse(await readFile('seeds/events.expansion.source.json', 'utf8')),
      )
    : null
  return { ...legacy, expansion }
}
