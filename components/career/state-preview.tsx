'use client'

import { useRouter } from 'next/navigation'
import { startCareer, type Career } from '@/lib/career/model'
import { writeCareer } from '@/lib/career/repository'

const states: { id: string; label: string; build: () => Career }[] = [
  { id: 'normal', label: 'normal', build: () => startCareer('DEV_HORSE_SERENE_STEP') },
  { id: 'high-fatigue', label: 'high-fatigue', build: () => { const c = startCareer('DEV_HORSE_SERENE_STEP'); return { ...c, condition: '피로 높음', values: { ...c.values, fatigue: 84, bodyLoad: 80 } } } },
  { id: 'injured', label: 'injured', build: () => { const c = startCareer('DEV_HORSE_SERENE_STEP'); return { ...c, health: '경상', condition: '치료 중', values: { ...c.values, fatigue: 48, bodyLoad: 66 } } } },
  { id: 'later-month', label: 'later-month', build: () => { const c = startCareer('DEV_HORSE_RED_COMET'); return { ...c, month: 3, careerTurnIndex: 3, calendarDate: { year: 2028, month: 6 } } } },
]

export function StatePreview() {
  const router = useRouter()
  return <main className="mx-auto max-w-xl p-8">
    <h1 className="font-serif text-xl">State preview (development only)</h1>
    <p className="mt-2 text-sm text-muted-foreground">선택한 상태의 저장 데이터를 만들고 홈으로 이동합니다. 프로덕션 빌드에서는 열리지 않습니다.</p>
    <ul className="mt-6 grid gap-2">
      {states.map(state => <li key={state.id}><button type="button" onClick={() => { writeCareer(state.build()); router.push('/') }} className="w-full rounded-lg border border-border bg-card px-4 py-3 text-left text-sm hover:bg-accent/40">{state.label}</button></li>)}
    </ul>
  </main>
}
