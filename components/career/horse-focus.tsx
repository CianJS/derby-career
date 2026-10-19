import { HeartPulse } from 'lucide-react'
import { labels, statKeys, type Career } from '@/lib/career/model'

export function HorseFocus({ career }: { career: Career }) {
  const aptitudes = career.horse.aptitude.filter(([, grade]) => grade === 'A')
  return <section aria-labelledby="horse-focus" className="lab-horse-focus px-4 py-3 md:px-5">
    <div className="grid items-center gap-x-6 gap-y-3 lg:grid-cols-[minmax(11rem,.9fr)_minmax(0,2fr)_minmax(0,1.1fr)]">
      <div><p className="ui-label">HORSE IN FOCUS</p><h2 id="horse-focus" className="mt-1 text-xl font-bold">{career.horse.name}</h2><p className="mt-1 text-xs text-muted-foreground">{career.age}세 · 성장형 {career.horse.growth} · {career.record} · 누적 상금 {career.prize}</p>{aptitudes.length > 0 && <p className="mt-1 text-xs"><span className="text-muted-foreground">주요 적성</span>{aptitudes.map(([label, grade]) => <span key={label} className="ml-2">{label} <b className="text-primary">{grade}</b></span>)}</p>}</div>
      <dl className="grid grid-cols-5 gap-3 lg:border-x lg:border-border lg:px-6">{statKeys.map(key => <div key={key}><dt className="text-xs text-muted-foreground">{labels[key]}</dt><dd className="mt-1 text-xl font-bold tabular-nums" data-stat={key}>{career.values[key]}</dd><div aria-hidden className="lab-meter mt-2"><i style={{ width: `${Math.min(100, career.values[key] / 10)}%` }} /></div></div>)}</dl>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">{[['피로', career.values.fatigue], ['신체 부하', career.values.bodyLoad], ['컨디션', career.condition], ['건강', career.health]].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{label === '건강' && <HeartPulse className="mr-1 inline text-sage" size={13} aria-hidden />}{value}</dd></div>)}</dl>
    </div>
  </section>
}
