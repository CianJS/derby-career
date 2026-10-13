import { createHash } from 'node:crypto'
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
export const digest = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex')
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
