import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import openapiTS,{astToString,COMMENT_HEADER} from 'openapi-typescript'
import SwaggerParser from '@apidevtools/swagger-parser'
const contract=resolve('../../contracts/openapi.yaml')
await SwaggerParser.validate(contract)
const generated=COMMENT_HEADER+astToString(await openapiTS(new URL(`file://${contract}`)))
const current=await readFile('../../packages/shared/src/generated/api.ts','utf8')
if(generated!==current) throw new Error('Generated API types are stale. Run npm run contract:generate and commit both files.')
console.log('OpenAPI is valid and generated types match')
