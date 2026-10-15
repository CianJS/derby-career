'use client'

import { useState } from 'react'
import { useCareer } from '@/lib/career/store'
import { jockeyProfiles } from '@/lib/career/race-entry'
import { summarizeRecords } from '@/lib/career/records'
import { Flag } from 'lucide-react'
import type { View, CareerHorse } from './legacy-types'
import { Section } from './presentation'
import { Management } from './management'
import { jockeys, STABLE_CONTRACTED_JOCKEY_IDS } from './legacy-catalog'

export function Jockeys({
  setView,
  onSelect,
}: {
  setView: (v: View) => void
  onSelect: (id: string) => void
}) {
  const { career } = useCareer()
  const [tab, setTab] = useState('contract')
  const contractedIds = career?.contractedJockeyIds ?? STABLE_CONTRACTED_JOCKEY_IDS
  const list = jockeys.filter((j) => contractedIds.includes(j.id) === (tab === 'contract'))
  return (
    <Management
      title="기수"
      eyebrow="JOCKEYS"
      description="계약 기수와 계약 가능한 기수를 관리합니다. 최대 3명."
    >
      <div className="flex w-fit gap-1 rounded-xl border border-border bg-card p-1">
        <button
          onClick={() => setTab('contract')}
          className={`rounded-lg px-4 py-2 text-xs ${tab === 'contract' ? 'bg-primary text-primary-foreground' : ''}`}
        >
          계약 기수 {contractedIds.length} / 3
        </button>
        <button
          onClick={() => setTab('available')}
          className={`rounded-lg px-4 py-2 text-xs ${tab === 'available' ? 'bg-primary text-primary-foreground' : ''}`}
        >
          계약 가능 기수
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((j) => (
          <button
            key={j.name}
            onClick={() => {
              onSelect(j.id)
              setView('jockey')
            }}
            className="rounded-xl border border-border bg-card p-4 text-left hover:bg-accent/40"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-full bg-primary/20 text-primary">
                <Flag size={16} />
              </div>
              <div>
                <p className="font-serif">{j.name}</p>
                <p className="text-[11px] text-muted-foreground">{j.meta}</p>
              </div>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">{j.style}</p>
            <p className="mt-1 text-xs text-primary">
              {contractedIds.includes(j.id) ? '계약 중' : '계약 가능'}
            </p>
            {career?.horse ? (
              <p className="mt-1 text-xs">
                현재 육성마 호흡도 · <b className="text-primary">{j.chem} / 100</b>
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">현재 육성마 없음</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-xs">
              {['스타트', '페이스 판단', '진로 판단', '승부 타이밍', '기승 안정'].map((a, i) => (
                <span key={a} className="flex justify-between border-b border-border py-1">
                  <span className="text-muted-foreground">{a}</span>
                  <b>{j.abilities[i]}</b>
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </Management>
  )
}

export function Jockey({
  setView,
  jockeyId,
  horses,
}: {
  setView: (v: View) => void
  jockeyId: string
  horses: CareerHorse[]
}) {
  const { career } = useCareer()
  const j = jockeys.find((j) => j.id === jockeyId) ?? jockeys[0]
  const riddenHorses = horses.filter((h) => h.raceRecords?.some((r) => r.jockeyId === j.id))
  const records = riddenHorses.flatMap((h) =>
    (h.raceRecords ?? [])
      .filter((r) => r.jockeyId === j.id)
      .map((r) => [r.date, h.name, r.race, r.grade ?? '—', r.result]),
  )
  return (
    <Management
      title={j.name}
      eyebrow="JOCKEY RECORD"
      description="기수의 능력과 기승 기록을 조회합니다."
    >
      <button
        onClick={() => setView('jockeys')}
        className="w-fit text-xs text-muted-foreground hover:text-foreground"
      >
        ← 기수 목록
      </button>
      <Section eyebrow="PROFILE / CONTRACT" title="프로필 · 계약">
        <div className="grid grid-cols-2 md:grid-cols-3">
          {[
            ['나이', jockeyProfiles[j.id] ? `${jockeyProfiles[j.id].age}세` : '—'],
            ['국가', jockeyProfiles[j.id]?.nationality ?? '—'],
            ['주요 스타일', j.style],
            [
              '계약 상태',
              (career?.contractedJockeyIds ?? STABLE_CONTRACTED_JOCKEY_IDS).includes(j.id)
                ? '계약 중'
                : '미계약',
            ],
            [
              '계약 만료일',
              (career?.contractedJockeyIds ?? STABLE_CONTRACTED_JOCKEY_IDS).includes(j.id)
                ? '만료일 정보 없음'
                : '—',
            ],
            career?.horse
              ? ['현재 육성마와 호흡도', `${j.chem} / 100`]
              : ['현재 육성마', '현재 육성마 없음'],
          ].map(([a, b]) => (
            <div key={a} className="border-b border-r border-border px-4 py-3">
              <span className="text-xs text-muted-foreground">{a}</span>
              <p className="mt-1 text-sm">{b}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="ABILITIES" title="기수 능력">
        <div className="grid gap-4 md:grid-cols-5">
          {['스타트', '페이스 판단', '진로 판단', '승부 타이밍', '기승 안정'].map((a, i) => (
            <div
              key={a}
              className="flex items-center justify-between border-b border-border py-2 text-xs"
            >
              <span className="text-muted-foreground">{a}</span>
              <b className="tabular-nums text-primary">{j.abilities[i]}</b>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="RIDING RECORD" title="최근 기승 기록">
        <div className="overflow-x-auto">
          <div className="grid min-w-[620px] grid-cols-[100px_1.2fr_1.3fr_70px_70px] border-b border-border px-3 pb-2 text-[10px] text-muted-foreground">
            <span>날짜</span>
            <span>말</span>
            <span>경주</span>
            <span>등급</span>
            <span>결과</span>
          </div>
          {records.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">최근 기승 기록이 없습니다.</p>
          )}
          {records.map((r) => (
            <div
              key={r.join('-')}
              className="grid min-w-[620px] grid-cols-[100px_1.2fr_1.3fr_70px_70px] border-b border-border px-3 py-3 text-xs"
            >
              <button onClick={() => setView('horse')} className="text-left">
                {r[0]}
              </button>
              <button
                onClick={() => setView('horse')}
                className="text-left font-serif hover:text-primary"
              >
                {r[1]}
              </button>
              <button
                onClick={() => setView('race')}
                className="text-left font-serif hover:text-primary"
              >
                {r[2]}
              </button>
              <span>{r[3]}</span>
              <span className="text-primary">{r[4]}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="HORSES" title="함께한 말">
        <div className="flex flex-col gap-2">
          {riddenHorses.length === 0 ? (
            <p className="border-y border-border py-4 text-sm text-muted-foreground">
              함께한 말이 없습니다.
            </p>
          ) : (
            riddenHorses.map((h) => (
              <p key={h.id} className="border-b border-border py-3 text-sm">
                {h.name} ·{' '}
                {summarizeRecords(h.raceRecords?.filter((r) => r.jockeyId === j.id)).record}
              </p>
            ))
          )}
        </div>
      </Section>
    </Management>
  )
}
