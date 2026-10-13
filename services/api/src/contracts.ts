import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse } from 'yaml'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 검증된 OpenAPI/JSON Schema의 가변 노드를 변환하는 라이브러리 경계에만 사용한다.
type ContractValue = any
export type ApiContract = Record<string, ContractValue>

export async function readContract() {
  return parse(await readFile(resolve('../../contracts/openapi.yaml'), 'utf8')) as ApiContract
}
export function resolveSchema(schema: ContractValue, spec: ApiContract): ContractValue {
  if (Array.isArray(schema)) {
    return schema.map((x) => resolveSchema(x, spec))
  }
  if (!schema || typeof schema !== 'object') {
    return schema
  }
  if (schema.nullable) {
    const { nullable, ...rest } = schema
    return { anyOf: [resolveSchema(rest, spec), { type: 'null' }] }
  }
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/')) {
      throw new Error('External OpenAPI references are not supported')
    }
    const target = schema.$ref
      .slice(2)
      .split('/')
      .reduce((value: ContractValue, key: string) => value[key], spec)
    return resolveSchema(target, spec)
  }
  const result = Object.fromEntries(
    Object.entries(schema).map(([k, v]) => [k, resolveSchema(v, spec)]),
  )
  if (result.exclusiveMinimum === true) {
    result.exclusiveMinimum = result.minimum
    delete result.minimum
  }
  if (result.exclusiveMaximum === true) {
    result.exclusiveMaximum = result.maximum
    delete result.maximum
  }
  return result
}
// Request validation and response serialization come from the same checked-in OpenAPI source.
export function routeSchema(spec: ApiContract, path: string, method: string) {
  const operation = spec.paths[path][method.toLowerCase()]
  if (!operation) {
    throw new Error(`Missing API contract: ${method} ${path}`)
  }
  const schema: Record<string, ContractValue> = {}
  const params = [...(spec.paths[path].parameters ?? []), ...(operation.parameters ?? [])].map(
    (x) => resolveSchema(x, spec),
  )
  for (const [where, key] of [
    ['path', 'params'],
    ['query', 'querystring'],
  ] as const) {
    const part = params.filter((x) => x.in === where)
    if (part.length) {
      schema[key] = {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(part.map((x) => [x.name, resolveSchema(x.schema, spec)])),
        required: part.filter((x) => x.required).map((x) => x.name),
      }
    }
  }
  if (operation.requestBody) {
    schema.body = resolveSchema(operation.requestBody.content['application/json'].schema, spec)
  }
  schema.response = Object.fromEntries(
    Object.entries(operation.responses)
      .map(([code, value]) => {
        const response = resolveSchema(value, spec)
        return [code, response.content?.['application/json']?.schema]
      })
      .filter(([, value]) => value),
  )
  return schema
}
