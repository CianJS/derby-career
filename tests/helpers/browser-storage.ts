export function browserStorage() {
  const data = new Map<string, string>()
  const cookies = new Map<string, string>()
  let rejectWrites = false
  let ignoreWrites = false
  let rejectRemovals = false
  let cookieReads = 0
  const target: Storage = {
    get length() {
      return data.size
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem(key, value) {
      if (rejectWrites) {
        throw new DOMException('Full', 'QuotaExceededError')
      }
      if (!ignoreWrites) {
        data.set(key, String(value))
      }
    },
    removeItem(key) {
      if (rejectRemovals) {
        throw new DOMException('Blocked', 'SecurityError')
      }
      data.delete(key)
    },
    clear: () => data.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: target })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      get cookie() {
        cookieReads++
        return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ')
      },
      set cookie(_value: string) {
        throw new Error('Cookie writes are blocked')
      },
    },
  })
  return {
    data,
    cookies,
    target,
    get cookieReads() {
      return cookieReads
    },
    rejectWrites: (value: boolean) => {
      rejectWrites = value
    },
    ignoreWrites: (value: boolean) => {
      ignoreWrites = value
    },
    rejectRemovals: (value: boolean) => {
      rejectRemovals = value
    },
  }
}
