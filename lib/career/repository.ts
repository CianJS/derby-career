import { assertCareer, type Career, type Horse, type Stat, labels, statKeys } from './model'

const key = 'derby-career-lifecycle-checkpoint-1'
function readCookie(name: string): string | null {
  return document.cookie.split('; ').find(cookie => cookie.startsWith(`${name}=`))?.slice(name.length + 1) ?? null
}
function writeCookie(name: string, value: string, maxAge = 31536000) {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
}
export function readCareer(): Career | null {
  const pointer = readCookie(key)
  if (!pointer) return migrateLegacy()
  const [generation, countText] = pointer.split('.')
  const count = Number(countText)
  if (!/^[a-zA-Z0-9-]+$/.test(generation) || !Number.isInteger(count) || count < 1 || count > 16) throw new Error('저장 정보가 손상되었습니다. 저장 데이터는 덮어쓰지 않습니다.')
  let payload = ''
  for (let i = 0; i < count; i++) {
    const chunk = readCookie(`${key}-${generation}-${i}`)
    if (chunk === null) throw new Error('저장 데이터 일부를 읽을 수 없습니다. 쿠키 설정을 확인해 주세요.')
    payload += chunk
  }
  const state: unknown = JSON.parse(decodeURIComponent(payload))
  assertCareer(state)
  return state
}
export function writeCareer(state: Career): void {
  assertCareer(state)
  const previous = readCookie(key)
  const generation = crypto.randomUUID()
  const payload = encodeURIComponent(JSON.stringify(state))
  const chunks = payload.match(/.{1,2800}/g)!
  if (chunks.length > 16) throw new Error('저장 용량을 초과했습니다.')
  // Publish the pointer only after every chunk is verified, so interrupted writes keep the prior save intact.
  for (let i = 0; i < chunks.length; i++) {
    const name = `${key}-${generation}-${i}`
    writeCookie(name, chunks[i])
    if (readCookie(name) !== chunks[i]) throw new Error('저장하지 못했습니다. 브라우저의 쿠키 허용 설정을 확인해 주세요.')
  }
  const pointer = `${generation}.${chunks.length}`
  writeCookie(key, pointer)
  if (readCookie(key) !== pointer) throw new Error('저장 확정에 실패했습니다. 다시 시도해 주세요.')
  if (previous) {
    const [oldGeneration, count] = previous.split('.')
    for (let i = 0; i < Math.min(Number(count), 16); i++) writeCookie(`${key}-${oldGeneration}-${i}`, '', 0)
  }
}
function migrateLegacy(): Career | null {
  const raw = readCookie('derby-career-lifecycle')
  if (!raw) return null
  const legacy = JSON.parse(decodeURIComponent(raw))
  if (!legacy.activeHorse) return null
  const old = legacy.activeHorse
  const stats = Object.fromEntries(statKeys.map(stat => [stat, old.stats?.find(([label]: [string, number]) => label === labels[stat])?.[1]])) as Record<Stat, number>
  const horse: Horse = { id: old.id, name: old.name, growth: old.growth, description: old.growthNote || '', stats, aptitude: (old.aptitude || []).map(([, name, grade]: string[]) => [name, grade]) }
  const state: Career = { version: 1, horse, age: parseInt(old.age) || 2, month: legacy.month || 1, values: { ...stats, fatigue: old.fatigue ?? 5, bodyLoad: old.bodyLoad ?? 5 }, condition: old.condition || '보통', health: '정상', record: old.record || '0전 0승', prize: old.prize || '₩0', action: null, recent: [] }
  assertCareer(state)
  writeCareer(state)
  return state
}
