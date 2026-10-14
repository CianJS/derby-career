'use client'

import { useCareer } from '@/lib/career/store'
import { summarizeRecords } from '@/lib/career/records'
import type { View, CareerHorse } from './legacy-types'
import { Meter, Section, FocusShell } from './presentation'
import { Management } from './management'
import { jockeys } from './legacy-catalog'

export function Horse({
  setView,
  onRetire,
  horse,
}: {
  setView: (v: View) => void
  onRetire: () => void
  horse: CareerHorse
}) {
  const { career } = useCareer()
  const summary = summarizeRecords(horse.raceRecords)
  const stats = horse.stats
  const apt = horse.aptitude
  return (
    <FocusShell setView={setView}>
      <p className="ui-label text-primary">HORSE RECORD · FOCUS PLAY</p>
      <h1 className="ui-page-title mt-2 font-serif text-3xl">{horse.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        현재 육성마 · {horse.age} {horse.sex}
      </p>
      <div className="mt-6">
        <Section eyebrow="BASIC / CAREER" title="기본 정보 · 커리어">
          <div className="grid grid-cols-2 md:grid-cols-4">
            {[
              ['나이', horse.age],
              ['성별', horse.sex],
              ['출생지', '대한민국'],
              ['클래스', 'OPEN'],
              ['활동 상태', '현역'],
              ['성장형', horse.growth],
              ['통산 전적', horse.record],
              ['누적 상금', horse.prize],
              ['최고 성적', horse.best],
            ].map(([a, b]) => (
              <div key={a} className="border-b border-r border-border px-4 py-3">
                <span className="text-xs text-muted-foreground">{a}</span>
                <p className="mt-1 text-sm">{b}</p>
              </div>
            ))}
          </div>
        </Section>
        <Section eyebrow="ABILITY" title="능력">
          <div className="grid gap-4 md:grid-cols-5">
            {stats.map(([n, v]) => (
              <div key={n} className="border-b border-border pb-3">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{n}</span>
                  <b className="tabular-nums">{v}</b>
                </div>
                <div className="mt-3">
                  <Meter value={v} />
                </div>
              </div>
            ))}
          </div>
        </Section>
        <Section eyebrow="APTITUDE" title="적성">
          <div className="grid gap-x-8 md:grid-cols-3">
            {['마장', '거리', '각질'].map((group) => (
              <div key={group}>
                <p className="mb-2 text-xs text-muted-foreground">{group}</p>
                {apt
                  .filter(([g]) => g === group)
                  .map(([, n, v]) => (
                    <div
                      key={n}
                      className="flex justify-between border-b border-border py-2 text-xs"
                    >
                      <span>{n}</span>
                      <b className={v === 'A' ? 'text-primary' : ''}>{v}</b>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </Section>
        <Section eyebrow="RACE RECORD" title="주요 경주 기록">
          <div className="overflow-x-auto">
            <div className="grid min-w-[680px] grid-cols-[100px_1.5fr_70px_80px_110px_70px_120px] border-b border-border px-3 pb-2 text-[10px] text-muted-foreground">
              <span>날짜</span>
              <span>경주</span>
              <span>등급</span>
              <span>거리</span>
              <span>기수</span>
              <span>결과</span>
              <span>상금</span>
            </div>
            {!horse.raceRecords?.length && (
              <p className="py-4 text-sm text-muted-foreground">경주 기록이 없습니다.</p>
            )}
            {(horse.raceRecords ?? [])
              .map((record) => [
                record.date,
                record.race,
                record.grade ?? '—',
                record.distance ? `${record.distance}m` : '—',
                record.jockeyName ?? '—',
                record.result,
                `₩${(record.prizeMoney ?? 0).toLocaleString('ko-KR')}`,
              ])
              .map((r) => (
                <button
                  key={r[1]}
                  onClick={() => setView('race')}
                  className="grid min-w-[680px] w-full grid-cols-[100px_1.5fr_70px_80px_110px_70px_120px] border-b border-border px-3 py-3 text-left text-xs hover:bg-accent/40"
                >
                  {r.map((v, i) => (
                    <span key={i} className={i === 1 ? 'font-serif text-sm' : ''}>
                      {v}
                    </span>
                  ))}
                </button>
              ))}
          </div>
        </Section>
        <div className="grid gap-5 md:grid-cols-2">
          <Section eyebrow="KEY JOCKEYS" title="주요 기수">
            {summary.jockeyRelations.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">함께한 기수가 없습니다.</p>
            ) : (
              summary.jockeyRelations.map((relation) => (
                <p key={relation.jockeyId} className="border-b border-border py-3 text-sm">
                  {jockeys.find((j) => j.id === relation.jockeyId)?.name ??
                    horse.raceRecords?.find((r) => r.jockeyId === relation.jockeyId)
                      ?.jockeyName}{' '}
                  · {relation.starts}전 {relation.wins}승 ·{' '}
                  {career?.contractedJockeyIds.includes(relation.jockeyId) ? '계약 중' : '미계약'}
                </p>
              ))
            )}
          </Section>
          <Section eyebrow="CAREER TIMELINE" title="주요 사건">
            <div className="flex flex-col gap-3 text-xs">
              {summary.careerTimeline.length === 0 ? (
                <p className="text-muted-foreground">아직 기록이 없습니다.</p>
              ) : (
                summary.careerTimeline.map((event, index) => (
                  <p key={`${event.date}-${index}`}>
                    <span className="mr-4 text-muted-foreground">{event.date}</span>
                    {event.text}
                  </p>
                ))
              )}
            </div>
          </Section>
        </div>
      </div>
      <div className="mt-6">
        <button
          onClick={onRetire}
          className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs"
        >
          은퇴
        </button>
      </div>
    </FocusShell>
  )
}

export function ArchivedHorseRecord({
  setView,
  horse,
}: {
  setView: (v: View) => void
  horse: CareerHorse
}) {
  return (
    <Management
      title={horse.name}
      eyebrow="HORSE RECORD · CAREER ARCHIVE"
      description="마구간에 보존된 은퇴 경주마의 기록입니다."
    >
      <button onClick={() => setView('stable')} className="mb-5 text-xs text-primary">
        ← 마구간으로
      </button>
      <Section eyebrow="BASIC / CAREER" title="기본 정보 · 커리어">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <span className="ui-metadata">나이</span>
            <p className="mt-2">{horse.age}</p>
          </div>
          <div>
            <span className="ui-metadata">성별</span>
            <p className="mt-2">{horse.sex}</p>
          </div>
          <div>
            <span className="ui-metadata">성장형</span>
            <p className="mt-2">{horse.growth}</p>
          </div>
          <div>
            <span className="ui-metadata">은퇴 시점</span>
            <p className="mt-2">{horse.retiredAt || '기록 없음'}</p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <span className="ui-metadata">통산 전적</span>
            <p className="mt-2">{horse.record}</p>
          </div>
          <div>
            <span className="ui-metadata">최고 성적</span>
            <p className="mt-2">{horse.best}</p>
          </div>
          <div>
            <span className="ui-metadata">누적 상금</span>
            <p className="mt-2">{horse.prize}</p>
          </div>
        </div>
      </Section>
      <Section eyebrow="FINAL ABILITIES" title="최종 능력치">
        <div className="grid gap-2 md:grid-cols-5">
          {horse.stats.map(([label, value]) => (
            <div key={label} className="border-b border-border py-3">
              <span className="ui-metadata">{label}</span>
              <b className="mt-2 block text-primary">{value}</b>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="APTITUDE" title="적성">
        <div className="grid gap-2 md:grid-cols-4">
          {horse.aptitude.map(([group, label, grade]) => (
            <div
              key={group + label}
              className="flex justify-between border-b border-border py-2 text-sm"
            >
              <span>
                {group} · {label}
              </span>
              <b className="text-primary">{grade}</b>
            </div>
          ))}
        </div>
      </Section>
      <ArchivedHorseHistory horse={horse} />
    </Management>
  )
}

function ArchivedHorseHistory({ horse }: { horse: CareerHorse }) {
  const records = horse.raceRecords ?? []
  const relations = Array.from(
    records.reduce((map, r) => {
      if (!r.jockeyId) {
        return map
      }
      const entry = map.get(r.jockeyId) ?? { name: r.jockeyName ?? r.jockeyId, starts: 0, best: 99 }
      entry.starts += 1
      const place = r.placing ?? Number(r.result.match(/^(\d+)/)?.[1] ?? 99)
      entry.best = Math.min(entry.best, place || 99)
      return map.set(r.jockeyId, entry)
    }, new Map<string, { name: string; starts: number; best: number }>()),
  )
  const timeline = [
    ['육성 시작', '육성을 시작했습니다'],
    ...records.slice(0, 4).map((r) => [r.date, `${r.race} ${r.result}`]),
    [horse.retiredAt || '은퇴', '은퇴'],
  ]
  return (
    <>
      <Section eyebrow="RACE RECORD" title="출전 기록">
        {records.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">출전 기록이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid min-w-[680px] grid-cols-[80px_1.4fr_60px_70px_1fr_60px_1fr] gap-2 border-b border-border px-3 pb-2 text-[10px] text-muted-foreground">
              <span>날짜</span>
              <span>경주</span>
              <span>등급</span>
              <span>거리</span>
              <span>기수</span>
              <span>결과</span>
              <span>상금</span>
            </div>
            {records.map((r, i) => (
              <div
                key={r.raceRunId ?? `${r.date}-${i}`}
                className="grid min-w-[680px] grid-cols-[80px_1.4fr_60px_70px_1fr_60px_1fr] gap-2 border-b border-border px-3 py-2.5 text-xs"
              >
                <span className="tabular-nums text-muted-foreground">{r.date}</span>
                <span className="font-serif">{r.race}</span>
                <span>{r.grade ?? '—'}</span>
                <span className="tabular-nums">{r.distance ? `${r.distance}m` : '—'}</span>
                <span>{r.jockeyName ?? '—'}</span>
                <span className="text-primary">{r.result}</span>
                <span className="tabular-nums">
                  {r.prizeMoney !== undefined ? `₩${r.prizeMoney.toLocaleString('ko-KR')}` : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section eyebrow="JOCKEY RELATIONSHIPS" title="함께한 기수">
        {relations.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">함께한 기수 기록이 없습니다.</p>
        ) : (
          <div className="grid gap-x-6 md:grid-cols-2">
            {relations.map(([id, r]) => (
              <div
                key={id}
                className="flex items-center justify-between border-b border-border py-2.5 text-xs"
              >
                <b className="font-serif text-sm">{r.name}</b>
                <span className="text-muted-foreground">
                  {r.starts}전 · Chemistry {jockeys.find((j) => j.id === id)?.chem ?? '—'} · 최고{' '}
                  {r.best === 99 ? '—' : `${r.best}착`}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section eyebrow="CAREER TIMELINE" title="커리어 타임라인">
        <ol>
          {timeline.map(([when, what], i) => (
            <li
              key={`${when}-${i}`}
              className="flex gap-4 border-b border-border py-2 text-xs last:border-b-0"
            >
              <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{when}</span>
              <span>{what}</span>
            </li>
          ))}
        </ol>
      </Section>
    </>
  )
}
