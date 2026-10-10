const key = 'derby-career-lifecycle-v2'
const cookie = (name: string) => document.cookie.split('; ').find(item => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? null
function put(name: string, value: string, maxAge = 31536000) {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
}

export function readLifecycleSave(): unknown {
  const pointer = cookie(key)
  if (!pointer) {
    const legacy = cookie('derby-career-lifecycle')
    return legacy ? JSON.parse(decodeURIComponent(legacy)) : null
  }
  const [generation, countText] = pointer.split('.')
  const count = Number(countText)
  if (!/^[a-zA-Z0-9-]+$/.test(generation) || !Number.isInteger(count) || count < 1 || count > 32) throw new Error('마방 저장 정보를 읽을 수 없습니다. 기존 기록은 유지됩니다.')
  let payload = ''
  for (let i = 0; i < count; i++) {
    const chunk = cookie(`${key}-${generation}-${i}`)
    if (chunk === null) throw new Error('마방 저장 기록 일부를 읽을 수 없습니다.')
    payload += chunk
  }
  const envelope = JSON.parse(decodeURIComponent(payload))
  if (envelope.version !== 2 || !envelope.state || typeof envelope.state !== 'object') throw new Error('지원하지 않는 마방 저장 형식입니다.')
  return envelope.state
}

export function writeLifecycleSave(state: unknown): void {
  const old = cookie(key)
  const generation = crypto.randomUUID()
  const chunks = encodeURIComponent(JSON.stringify({ version: 2, state })).match(/.{1,2800}/g)!
  if (chunks.length > 32) throw new Error('마방 저장 용량을 초과했습니다.')
  for (let i = 0; i < chunks.length; i++) {
    const name = `${key}-${generation}-${i}`
    put(name, chunks[i])
    if (cookie(name) !== chunks[i]) throw new Error('마방 기록을 저장하지 못했습니다. 쿠키 설정을 확인해 주세요.')
  }
  // Switch the pointer only after every chunk is durable; retain the original v1 cookie.
  const pointer = `${generation}.${chunks.length}`
  put(key, pointer)
  if (cookie(key) !== pointer) throw new Error('마방 기록 저장 확정에 실패했습니다.')
  if (old) {
    const [previous, count] = old.split('.')
    for (let i = 0; i < Math.min(Number(count), 32); i++) put(`${key}-${previous}-${i}`, '', 0)
  }
}
