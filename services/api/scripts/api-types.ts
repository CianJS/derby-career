import { resolve } from 'node:path'
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript'
import ts from 'typescript'

export const API_TYPES_PATH = '../../packages/shared/src/generated/api.ts'

export async function generateApiTypes() {
  const contract = new URL(`file://${resolve('../../contracts/openapi.yaml')}`)
  const ast = await openapiTS(contract, {
    transform(schema, metadata) {
      if (metadata.path !== '#/components/schemas/Aptitudes') {
        return undefined
      }
      if (schema.type !== 'array') {
        throw new Error('The Aptitudes array schema changed; update its generated tuple mapping.')
      }
      const pair = schema.items
      if (
        !pair ||
        Array.isArray(pair) ||
        !('type' in pair) ||
        pair.type !== 'array' ||
        pair.minItems !== 2 ||
        pair.maxItems !== 2 ||
        !pair.items ||
        Array.isArray(pair.items) ||
        !('type' in pair.items) ||
        pair.items.type !== 'string'
      ) {
        throw new Error('The Aptitudes pair schema changed; update its generated tuple mapping.')
      }
      // Narrow only the existing aptitude pairs; keep unrelated event array types compatible.
      return ts.factory.createArrayTypeNode(
        ts.factory.createTupleTypeNode([
          ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
          ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
        ]),
      )
    },
  })
  return COMMENT_HEADER + astToString(ast)
}
