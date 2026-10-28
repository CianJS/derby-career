import Ajv from 'ajv'
import { readContract, resolveSchema } from '../../contracts'
// Reuse the authoritative definition contract; no new balance/schema copy.
const contract = await readContract()
export const validateRaceDefinition = new Ajv({ strict: false }).compile(
  resolveSchema(contract.components.schemas.RaceDefinition, contract),
)
