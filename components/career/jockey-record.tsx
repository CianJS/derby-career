'use client'

import { useState } from 'react'
import { useCareer } from '@/lib/career/store'
import { jockeyTrust } from '@/lib/career/jockey-trust-presentation'
import { JockeyTrustValue } from './jockey-trust'
import { jockeyProfiles } from '@/lib/career/race-entry'
import { summarizeRecords } from '@/lib/career/records'
import { Flag } from 'lucide-react'
import type { View, CareerHorse } from './legacy-types'
import { Section } from './presentation'
import { Management } from './management'
import { jockeys } from './legacy-catalog'

function savedRidingDate(date: string): number[] | null {
  if (typeof date !== 'string') {
    return null
  }
  const parts = date.trim().match(/^(\d{4})[.-](\d{1,2})(?:[.-](\d{1,2}))?$/)
  if (!parts) {
    return null
  }
  const [year, month, day = 0] = date.match(/\d+/g)!.map(Number)
  return year > 0 && month >= 1 && month <= 12 && (!parts[3] || (day >= 1 && day <= 31))
    ? [year, month, day]
    : null
}

export function compareRidingDates(a: { date: string }, b: { date: string }): number {
  const left = savedRidingDate(a.date)
  const right = savedRidingDate(b.date)
  if (!left || !right) {
    // Unknown dates follow known dates. Stable sort retains source order for ties/unknowns.
    return Number(!!right) - Number(!!left)
  }
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const delta = (right[i] ?? 0) - (left[i] ?? 0)
    if (delta) {
      return delta
    }
  }
  return 0
}

function savedJockeyContracts(snapshot: ReturnType<typeof useCareer>): readonly string[] | null {
  if (!snapshot.ready) {
    return null
  }
  return snapshot.mode === 'server'
    ? (snapshot.workspace?.stable?.contractedJockeyIds ??
        snapshot.career?.contractedJockeyIds ??
        null)
    : (snapshot.career?.contractedJockeyIds ?? snapshot.lifecycle?.contractedJockeyIds ?? [])
}

export function Jockeys({
  setView,
  onSelect,
}: {
  setView: (v: View) => void
  onSelect: (id: string) => void
}) {
  const snapshot = useCareer()
  const { career } = snapshot
  const [tab, setTab] = useState('contract')
  const contractedIds = savedJockeyContracts(snapshot)
  const list = contractedIds
    ? jockeys.filter((j) => contractedIds?.includes(j.id) === (tab === 'contract'))
    : []
  return (
    <Management
      title="기수"
      eyebrow="JOCKEYS"
      description="저장된 계약 상태와 기수 정보를 확인합니다. 추가 영입은 지원하지 않습니다."
    >
      <div className="flex w-fit gap-1 rounded-xl border border-border bg-card p-1">
        <button
          onClick={() => setTab('contract')}
          className={`rounded-lg px-4 py-2 text-xs ${tab === 'contract' ? 'bg-primary text-primary-foreground' : ''}`}
        >
          계약 기수 {contractedIds?.length ?? '확인 중'}
        </button>
        <button
          onClick={() => setTab('available')}
          className={`rounded-lg px-4 py-2 text-xs ${tab === 'available' ? 'bg-primary text-primary-foreground' : ''}`}
        >
          미계약 기수
        </button>
      </div>
      {list.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {contractedIds === null
            ? '기수 계약 정보를 불러오는 중…'
            : tab === 'contract'
              ? '계약 기수가 없습니다.'
              : '미계약 기수가 없습니다.'}
        </p>
      )}
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
            <p className="mt-1 text-xs text-primary">
              {contractedIds?.includes(j.id) ? '계약 중' : '미계약'}
            </p>
            <p className="mt-1 text-xs">
              {career?.horse ? `${career.horse.name}와 신뢰도 · ` : '신뢰도 · '}
              <JockeyTrustValue trust={jockeyTrust(snapshot, j.id)} />
            </p>
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
  onSelectHorse,
}: {
  setView: (v: View) => void
  jockeyId: string
  horses: CareerHorse[]
  onSelectHorse?: (horseId: string, raceRunId?: string) => void
}) {
  const snapshot = useCareer()
  const { career } = snapshot
  const j = jockeys.find((j) => j.id === jockeyId)
  if (!j) {
    return (
      <Management title="기수" eyebrow="JOCKEY RECORD" description="기수 정보를 찾을 수 없습니다.">
        <button onClick={() => setView('jockeys')}>← 기수 목록</button>
      </Management>
    )
  }
  const riddenHorses = horses.filter((h) => h.raceRecords?.some((r) => r.jockeyId === j.id))
  const records = riddenHorses
    .flatMap((h) =>
      (h.raceRecords ?? [])
        .filter((r) => r.jockeyId === j.id)
        .map((r, index) => ({ ...r, horseId: h.id, horseName: h.name, sourceIndex: index })),
    )
    .sort(compareRidingDates)
  return (
    <Management
      title={j.name}
      eyebrow="JOCKEY RECORD"
      description="저장된 계약과 경기 기록을 기준으로 표시합니다."
      className="jockey-detail"
    >
      <button
        onClick={() => setView('jockeys')}
        className="w-fit text-xs text-muted-foreground hover:text-foreground"
      >
        ← 기수 목록
      </button>
      <Section className="jockey-profile" eyebrow="PROFILE / CONTRACT" title="프로필 · 계약">
        <div className="grid grid-cols-2 md:grid-cols-3">
          {[
            ['나이', jockeyProfiles[j.id] ? `${jockeyProfiles[j.id].age}세` : '—'],
            ['국가', jockeyProfiles[j.id]?.nationality ?? '—'],
            ['주요 스타일', j.style],
            [
              '계약 상태',
              savedJockeyContracts(snapshot)?.includes(j.id)
                ? '계약 중'
                : savedJockeyContracts(snapshot) === null
                  ? '계약 정보 없음'
                  : '미계약',
            ],
            [
              '계약 만료일',
              savedJockeyContracts(snapshot)?.includes(j.id) ? '만료일 정보 없음' : '—',
            ],
          ].map(([a, b]) => (
            <div key={a} className="border-b border-r border-border px-4 py-3">
              <span className="text-xs text-muted-foreground">{a}</span>
              <p className="mt-1 text-sm">{b}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section className="jockey-trust" eyebrow="HORSE / JOCKEY" title="말과 기수의 신뢰도">
        <p className="text-sm">
          {career?.horse ? `${career.horse.name} ↔ ${j.name} · ` : `${j.name} · `}
          <JockeyTrustValue trust={jockeyTrust(snapshot, j.id)} />
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          현재 육성마와 이 기수 사이의 관계이며, 기수의 공통 능력치와 다릅니다.
        </p>
      </Section>
      <Section className="jockey-abilities" eyebrow="ABILITIES" title="기수 능력">
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
      <Section className="jockey-records" eyebrow="RIDING RECORD" title="기승 기록">
        <p className="mb-3 text-xs text-muted-foreground">
          {snapshot.mode === 'server'
            ? '현재 불러온 현역마·은퇴마 기록을 저장 날짜가 최신인 순서로 표시합니다. 아직 불러오지 않은 은퇴마의 기록은 포함되지 않습니다.'
            : '저장된 현역마·은퇴마 기록을 날짜가 최신인 순서로 표시합니다.'}{' '}
          날짜를 확인할 수 없으면 원래 값을 함께 표시하며 목록 뒤에 둡니다.
        </p>
        <div
          className="jockey-record-scroll overflow-auto"
          role="region"
          aria-label="저장된 기승 기록"
          tabIndex={0}
        >
          <div className="grid min-w-[620px] grid-cols-[100px_1.2fr_1.3fr_70px_70px] border-b border-border px-3 pb-2 text-[10px] text-muted-foreground">
            <span>날짜</span>
            <span>말</span>
            <span>경주</span>
            <span>등급</span>
            <span>결과</span>
          </div>
          {records.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">확인된 기승 기록이 없습니다.</p>
          )}
          {records.map((r) => (
            <div
              key={`${r.horseId}:${r.raceRunId ?? `legacy:${r.sourceIndex}`}`}
              data-riding-record
              data-horse-id={r.horseId}
              data-race-run-id={r.raceRunId}
              className="grid min-w-[620px] grid-cols-[100px_1.2fr_1.3fr_70px_70px] border-b border-border px-3 py-3 text-xs"
            >
              {(
                [
                  [
                    'date',
                    savedRidingDate(r.date)
                      ? r.date
                      : `날짜 확인 불가${r.date ? ` · ${r.date}` : ''}`,
                  ],
                  ['horse', r.horseName],
                  ['race', r.race],
                ] as const
              ).map(([kind, text]) =>
                onSelectHorse ? (
                  <button
                    key={kind}
                    data-record-link={kind}
                    onClick={() => onSelectHorse(r.horseId, r.raceRunId)}
                    title="이 말의 저장된 경주 기록 보기"
                    className="text-left hover:text-primary"
                  >
                    {text}
                  </button>
                ) : (
                  <span key={kind}>{text}</span>
                ),
              )}
              <span>{r.grade ?? '—'}</span>
              <span className="text-primary">{r.result}</span>
            </div>
          ))}
          {records.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              게임용 경주는 해당 말의 저장된 경주 기록으로 연결됩니다.
            </p>
          )}
        </div>
      </Section>
      <Section className="jockey-horses" eyebrow="HORSES" title="함께한 말">
        <div
          className="jockey-horse-scroll flex flex-col gap-2"
          role="region"
          aria-label="함께한 말 목록"
          tabIndex={0}
        >
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
