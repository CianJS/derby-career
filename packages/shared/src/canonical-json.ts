/**
 * Single canonical JSON serialization for race provenance. The browser-side mapping
 * preview and the Node-side catalog audit hash approved revisions with it, so a
 * revision computed on one side always verifies on the other.
 */

/** Key-sorted structural copy, so repeated imports are independent of JSON property order. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonicalize(x)]),
    )
  }
  return value
}

/** Canonical JSON text. Undefined object values drop and undefined array items become null, as JSON.stringify does. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}
