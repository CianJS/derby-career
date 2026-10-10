import { HeartPulse } from 'lucide-react'
import { labels, statKeys, type Career } from '@/lib/career/model'

export function HorseFocus({ career }: { career: Career }) {
  return <section aria-labelledby="horse-focus" className="rounded-lg border border-border bg-card px-5 py-4">
    <p className="ui-label text-primary">HORSE IN FOCUS</p>
    <div className="mt-3 grid items-start gap-6 lg:grid-cols-[1fr_1.2fr_1fr]">
      <div><h2 id="horse-focus" className="font-serif text-2xl font-semibold">{career.horse.name}</h2><p className="mt-2 text-xs text-muted-foreground">{career.age}세 · 성장형 {career.horse.growth}</p><p className="mt-3 text-xs">{career.record} <span className="mx-2 text-muted-foreground">/</span> 누적 상금 {career.prize}</p></div>
      <dl className="grid grid-cols-5 gap-3 lg:border-x lg:border-border lg:px-6">{statKeys.map(key => <div key={key}><dt className="text-xs text-muted-foreground">{labels[key]}</dt><dd className="mt-2 text-xl font-semibold tabular-nums" data-stat={key}>{career.values[key]}</dd><div aria-hidden className="mt-3 h-1 bg-muted"><div className="h-1 bg-primary/65" style={{ width: `${Math.min(100, career.values[key] / 10)}%` }} /></div></div>)}</dl>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">{[['피로', career.values.fatigue], ['신체 부하', career.values.bodyLoad], ['컨디션', career.condition], ['건강', career.health]].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{label === '건강' && <HeartPulse className="mr-1 inline text-sage" size={13} aria-hidden />}{value}</dd></div>)}</dl>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3 text-xs"><span className="text-muted-foreground">주요 적성</span>{career.horse.aptitude.filter(([, grade]) => grade === 'A').map(([label, grade]) => <span key={label}>{label} <b className="ml-1 text-primary">{grade}</b></span>)}</div>
  </section>
}
