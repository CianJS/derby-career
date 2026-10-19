'use client'

import { useRouter } from 'next/navigation'
import { buildFixture, fixtureIds, fixtureLifecycle } from '@/lib/career/fixtures'
import { writeBrowserSave } from '@/lib/career/browser-save'
import { writeRaceLog } from '@/lib/career/race-log-repository'

const labels = fixtureIds.map(id => ({ id, label: buildLabel(id) }))
function buildLabel(id: (typeof fixtureIds)[number]) {
  return ({ normal: '육성 · 일반', 'active-home': '홈 · 육성마 있음', 'high-fatigue': '육성 · 피로 높음', injured: '육성 · 부상', 'later-month': '육성 · 경주 달', 'playback-12': '경주 · 12두', 'playback-18': '경주 · 18두', 'result-win': '결과 · 1착', 'result-lose': '결과 · 하위권', retired: '은퇴 직후', 'new-career': '새 육성마 선택', 'no-horse': '기수 · 육성마 없음' })[id]
}

export function StatePreview() {
  const router = useRouter()
  const load = (id: string) => {
    const fixture = buildFixture(id)
    writeBrowserSave({ career: fixture.career, lifecycle: fixtureLifecycle(fixture.archive) })
    if (fixture.log) writeRaceLog(fixture.log)
    router.push(`/?view=${fixture.view}`)
  }
  return <main className="mx-auto max-w-xl p-8">
    <h1 className="font-serif text-xl">State preview (development only)</h1>
    <p className="mt-2 text-sm text-muted-foreground">선택한 상태의 저장 데이터를 만들고 해당 화면으로 이동합니다. 프로덕션 빌드에서는 열리지 않습니다.</p>
    <ul className="mt-6 grid gap-2 sm:grid-cols-2">
      {labels.map(state => <li key={state.id}><button type="button" onClick={() => load(state.id)} className="w-full rounded-lg border border-border bg-card px-4 py-3 text-left text-sm hover:bg-accent/40"><span className="block">{state.label}</span><span className="block text-xs text-muted-foreground">{state.id}</span></button></li>)}
    </ul>
  </main>
}
