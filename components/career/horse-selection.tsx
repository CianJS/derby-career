'use client'

import { useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { horses, labels, statKeys } from '@/lib/career/model'
import { careerStore } from '@/lib/career/store'
import { cn } from '@/lib/utils'

export function HorseSelection({ busy }: { busy: boolean }) {
  const [selected, setSelected] = useState<string | null>(null)
  return <>
    <div className="mb-7">
      <p className="ui-label text-primary">HORSE SELECTION</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">첫 육성마를 선택하세요</h1>
      <p className="mt-3 text-sm text-muted-foreground">서로 다른 세 가지 가능성. 능력과 적성을 비교하고, 함께할 한 마리를 선택하세요.</p>
    </div>
    <fieldset disabled={busy}>
      <legend className="sr-only">육성마 후보 비교</legend>
      <div className="grid gap-4 md:grid-cols-3">
        {horses.map((horse, index) => <label key={horse.id} className={cn('lab-horse-candidate relative flex cursor-pointer flex-col gap-4 rounded-lg border bg-card p-5 transition-colors focus-within:ring-2 focus-within:ring-ring', selected === horse.id ? 'ui-selected' : 'border-border hover:border-primary/50')}>
          <input className="sr-only" type="radio" name="horse" value={horse.id} checked={selected === horse.id} onChange={() => setSelected(horse.id)} />
          <div className="flex items-center justify-between text-xs"><span className="tracking-widest text-muted-foreground">CANDIDATE 0{index + 1}</span><span className={cn('flex size-5 items-center justify-center rounded-full border', selected === horse.id ? 'border-primary text-primary' : 'border-border')}>{selected === horse.id && <Check size={13} aria-hidden />}</span></div>
          <div><h2 className="font-serif text-2xl font-semibold">{horse.name}</h2><p className="mt-2 text-xs text-muted-foreground">2세 <span className="mx-2">·</span> 성장형 <span className="text-primary">{horse.growth}</span></p></div>
          <p className="min-h-10 text-sm leading-5 text-muted-foreground">{horse.description}</p>
          <dl className="flex flex-col gap-3 border-y border-border py-4">
            {statKeys.map(key => <div key={key} className="grid grid-cols-[3rem_1fr_2.5rem] items-center gap-3 text-xs"><dt>{labels[key]}</dt><div aria-hidden className="h-1 bg-muted"><div className="h-1 bg-primary/65" style={{ width: `${horse.stats[key] / 10}%` }} /></div><dd className="text-right text-sm font-semibold tabular-nums">{horse.stats[key]}</dd></div>)}
          </dl>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">{horse.aptitude.map(([label, grade]) => <div key={label} className="flex justify-between gap-2"><dt className="text-muted-foreground">{label}</dt><dd className={cn('font-semibold', grade === 'A' && 'text-primary')}>{grade}</dd></div>)}</dl>
        </label>)}
      </div>
    </fieldset>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
      <p className="text-xs text-muted-foreground">{selected ? `${horses.find(h => h.id === selected)!.name} 선택됨 · 확정 후 Month 1이 시작됩니다.` : '후보를 선택하면 육성을 시작할 수 있습니다.'}</p>
      <Button size="lg" disabled={!selected || busy} onClick={() => selected && void careerStore.select(selected)}>{busy ? '저장 중…' : '이 말로 육성 시작'}<ArrowRight data-icon="inline-end" aria-hidden /></Button>
    </div>
  </>
}
