'use client'

import { careerProgress, type StarterJockeyId } from '@/packages/shared/src/domain'
import { countryName, supportedCountries, type SupportedCountry } from '@/lib/career/local-travel'
import { useEffect, useRef, useState } from 'react'
import { StarterCombination, starterJockey } from './starter-jockey-guidance'
import { ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { horses, labels, statKeys } from '@/lib/career/model'
import { careerStore, useCareer } from '@/lib/career/store'
import { cn } from '@/lib/utils'

export function HorseSelection({
  busy,
  starterJockeyId,
}: {
  busy: boolean
  starterJockeyId?: StarterJockeyId
}) {
  const { mode, candidates, workspace, ready, error } = useCareer()
  const options = mode === 'server' ? candidates.map((h) => h.definition) : horses
  const [homeCountry, setHomeCountry] = useState<SupportedCountry>('KOR')
  const [selected, setSelected] = useState<string | null>(null)
  const selectedHorse = options.find((horse) => horse.id === selected)
  const jockey = starterJockey(starterJockeyId)
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    title.current?.focus()
  }, [])
  return (
    <>
      <div className="mb-7">
        <p className="ui-label text-primary">HORSE SELECTION</p>
        <h1 ref={title} tabIndex={-1} className="mt-3 text-3xl font-semibold tracking-tight">
          첫 육성마를 선택하세요
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          실제 후보의 능력과 적성을 비교하고, 함께할 한 마리를 선택하세요.
        </p>
      </div>
      {jockey && (
        <p className="mb-5 text-sm text-muted-foreground">
          {jockey.jockey.name}의 {jockey.specialty} 특화와 각 말의 해당 전술 적성을 비교합니다.
          경주·거리 선택 전의 참고 안내이며, 승률이나 종합 기승 적합도는 아닙니다. 모든 전술을
          사용할 수 있고 계약은 아래 육성 시작 버튼에서 확정됩니다.
        </p>
      )}
      {mode === 'server' && !options.length && (
        <p role={error ? 'alert' : 'status'} className="mb-5 text-sm">
          {error ??
            (!ready || busy
              ? '서버 육성마 후보를 불러오는 중…'
              : '서버에 표시할 육성마 후보가 없습니다.')}
        </p>
      )}
      {mode === 'server' && !workspace?.stable && (
        <label className="mb-5 block text-sm">
          마방 소속 국가
          <select
            aria-label="마방 소속 국가"
            disabled={busy}
            value={homeCountry}
            onChange={(e) => setHomeCountry(e.target.value as SupportedCountry)}
            className="ml-3 min-h-11 rounded border border-border bg-background px-3"
          >
            {supportedCountries.map((c) => (
              <option key={c} value={c}>
                {countryName(c)}
              </option>
            ))}
          </select>
        </label>
      )}
      <fieldset disabled={busy}>
        <legend className="sr-only">육성마 후보 비교</legend>
        <div className="grid gap-4 md:grid-cols-3">
          {options.map((horse, index) => (
            <label
              key={horse.id}
              className={cn(
                'lab-horse-candidate relative flex cursor-pointer flex-col gap-4 rounded-lg border bg-card p-5 transition-colors focus-within:ring-2 focus-within:ring-ring',
                selected === horse.id ? 'ui-selected' : 'border-border hover:border-primary/50',
              )}
            >
              <input
                className="sr-only"
                type="radio"
                name="horse"
                value={horse.id}
                checked={selected === horse.id}
                onChange={() => setSelected(horse.id)}
              />
              <div className="flex items-center justify-between text-xs">
                <span className="tracking-widest text-muted-foreground">
                  CANDIDATE 0{index + 1}
                </span>
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full border',
                    selected === horse.id ? 'border-primary text-primary' : 'border-border',
                  )}
                >
                  {selected === horse.id && <Check size={13} aria-hidden />}
                </span>
              </div>
              <div>
                <h2 className="font-serif text-2xl font-semibold">{horse.name}</h2>
                <p className="mt-2 text-xs text-muted-foreground">
                  {careerProgress(1).age}세 시작 <span className="mx-2">·</span> 성장형{' '}
                  <span className="text-primary">{horse.growth}</span>
                </p>
              </div>
              <p className="min-h-10 text-sm leading-5 text-muted-foreground">
                {horse.description}
              </p>
              <dl className="flex flex-col gap-3 border-y border-border py-4">
                {statKeys.map((key) => (
                  <div
                    key={key}
                    className="grid grid-cols-[3rem_1fr_2.5rem] items-center gap-3 text-xs"
                  >
                    <dt>{labels[key]}</dt>
                    <div aria-hidden className="h-1 bg-muted">
                      <div
                        className="h-1 bg-primary/65"
                        style={{ width: `${horse.stats[key] / 10}%` }}
                      />
                    </div>
                    <dd className="text-right text-sm font-semibold tabular-nums">
                      {horse.stats[key]}
                    </dd>
                  </div>
                ))}
              </dl>
              {starterJockeyId && <StarterCombination id={starterJockeyId} horse={horse} />}
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                {horse.aptitude.map(([label, grade]) => (
                  <div key={label} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className={cn('font-semibold', grade === 'A' && 'text-primary')}>
                      {grade}
                    </dd>
                  </div>
                ))}
              </dl>
            </label>
          ))}
        </div>
      </fieldset>
      {selectedHorse && starterJockeyId && (
        <section aria-label="선택한 말과 초기 기수 조합" aria-live="polite" className="mt-5">
          <StarterCombination id={starterJockeyId} horse={selectedHorse} />
        </section>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
        <p className="text-xs text-muted-foreground">
          {selectedHorse
            ? `${selectedHorse.name} 선택됨 · 확정 후 1턴 · 1년 차가 시작됩니다.`
            : '후보를 선택하면 육성을 시작할 수 있습니다.'}
        </p>
        <Button
          size="lg"
          disabled={!selectedHorse || busy || !ready || (mode === 'server' && !!error)}
          onClick={() =>
            selectedHorse && void careerStore.select(selectedHorse.id, homeCountry, starterJockeyId)
          }
        >
          {busy ? '저장 중…' : '이 말로 육성 시작'}
          <ArrowRight data-icon="inline-end" aria-hidden />
        </Button>
      </div>
    </>
  )
}
