import type { Query } from '../db'
import type { CareerRow } from './career-rows'
import { careerJockeyRelations, type JockeyRelations } from '../../../../packages/shared/src/domain'

export async function readJockeyRelations(tx: Query, horseId: string): Promise<JockeyRelations> {
  const rows = (
    await tx.query<{ jockey_id: string; starts: number; chemistry: number }>(
      'SELECT jockey_id,starts,chemistry FROM jockey_chemistry WHERE horse_id=$1 ORDER BY jockey_id',
      [horseId],
    )
  ).rows
  return Object.fromEntries(
    rows.map((row) => [row.jockey_id, { starts: row.starts, trust: row.chemistry }]),
  )
}
export async function hydrateJockeyRelations(tx: Query, row: CareerRow) {
  const contracts = (
    await tx.query('SELECT jockey_id FROM jockey_contracts WHERE stable_id=$1 ORDER BY jockey_id', [
      row.stable_id,
    ])
  ).rows.map((x) => x.jockey_id as string)
  row.state = {
    ...row.state,
    contractedJockeyIds: contracts,
    jockeyTrust: await readJockeyRelations(tx, row.horse_id),
  }
}
/** Called inside the owner-locked Career command, together with result/event and receipt writes. */
export async function writeJockeyRelations(tx: Query, row: CareerRow) {
  for (const [id, relation] of Object.entries(careerJockeyRelations(row.state))) {
    await tx.query(
      `INSERT INTO jockey_chemistry(horse_id,jockey_id,starts,chemistry) VALUES($1,$2,$3,$4)
       ON CONFLICT(horse_id,jockey_id) DO UPDATE SET starts=EXCLUDED.starts,chemistry=EXCLUDED.chemistry
       WHERE (jockey_chemistry.starts,jockey_chemistry.chemistry) IS DISTINCT FROM (EXCLUDED.starts,EXCLUDED.chemistry)`,
      [row.horse_id, id, relation.starts, relation.trust],
    )
  }
}
