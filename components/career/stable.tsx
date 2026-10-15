'use client'

import { FilterMenu } from '@/components/career/filter-menu'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { View, CareerHorse } from './legacy-types'
import { Section } from './presentation'
import { Management } from './management'

export function Stable({
  setView,
  archive = [],
  onArchiveSelect: _onArchiveSelect = () => {},
}: {
  setView: (v: View) => void
  archive?: CareerHorse[]
  onArchiveSelect?: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('recent')
  const horses = archive.map(
    (horse, index) =>
      [
        horse.name,
        `${horse.age} ${horse.sex}`,
        horse.record,
        horse.best,
        horse.prize,
        horse.retiredAt || '기록 없음',
        index,
      ] as const,
  )
  const filtered = horses
    .filter(([, name]) => name.includes(query))
    .sort((a, b) =>
      sort === 'name'
        ? a[0].localeCompare(b[0], 'ko')
        : sort === 'wins'
          ? Number(b[2].match(/\d+승/)?.[0]) - Number(a[2].match(/\d+승/)?.[0])
          : sort === 'prize'
            ? Number(b[4].replace(/[^\d]/g, '')) - Number(a[4].replace(/[^\d]/g, ''))
            : b[6] - a[6],
    )
  return (
    <Management
      title="마구간"
      eyebrow="STABLE"
      description="육성을 마친 경주마와 그들의 커리어 기록을 조회합니다."
    >
      {archive.length === 0 && (
        <div className="ui-empty-state border-y border-border/70 py-8">
          <p>아직 기록된 경주마가 없습니다.</p>
          <p className="mt-1 text-sm">육성을 완료한 경주마의 커리어가 이곳에 보존됩니다.</p>
        </div>
      )}
      {archive.length > 1 && (
        <Section eyebrow="CAREER ARCHIVE · RECENT" title="최근 은퇴마">
          <div className="space-y-2">
            {archive.slice(0, 2).map((horse) => (
              <button
                key={horse.id}
                onClick={() => setView('horseArchive')}
                className="flex w-full items-center justify-between border-b border-border py-3 text-left"
              >
                <span>
                  <b className="font-serif">{horse.name}</b>
                  <span className="ml-3 text-xs text-muted-foreground">
                    {horse.retiredAt} · {horse.record}
                  </span>
                </span>
                <span className="text-xs text-primary">
                  기록 보기 <ChevronRight className="inline" size={14} />
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <label className="flex min-w-64 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <span>검색</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="말 이름 검색"
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">정렬</span>
          <FilterMenu
            label=""
            value={
              { recent: '최근 육성순', name: '이름순', wins: '통산 승수순', prize: '누적 상금순' }[
                sort
              ] ?? '최근 육성순'
            }
            options={['최근 육성순', '이름순', '통산 승수순', '누적 상금순']}
            onChange={(v) =>
              setSort(
                (
                  {
                    '최근 육성순': 'recent',
                    이름순: 'name',
                    '통산 승수순': 'wins',
                    '누적 상금순': 'prize',
                  } as Record<string, string>
                )[v] ?? 'recent',
              )
            }
            align="right"
          />
        </div>
      </div>
      <Section eyebrow="CAREER ARCHIVE" title="은퇴 경주마">
        <div className="hidden grid-cols-[1.5fr_1fr_1fr_1fr_1fr_100px_24px] gap-4 border-b border-border px-4 pb-3 text-[10px] tracking-wide text-muted-foreground md:grid">
          <span>이름</span>
          <span>나이·성별</span>
          <span>통산 전적</span>
          <span>최고 성적</span>
          <span>누적 상금</span>
          <span>은퇴 시점</span>
          <span />
        </div>
        {filtered.map(([name, age, record, best, prize, retired]) => (
          <button
            key={name}
            onClick={() => setView('horseArchive')}
            className="group grid w-full gap-2 border-b border-border px-4 py-4 text-left last:border-0 hover:bg-accent/40 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_100px_24px] md:items-center md:gap-4"
          >
            <span className="font-serif text-base">{name}</span>
            <span className="text-xs text-muted-foreground">{age}</span>
            <span className="text-xs">{record}</span>
            <span className="text-xs">{best}</span>
            <span className="text-xs text-primary">{prize}</span>
            <span className="text-xs text-muted-foreground">{retired}</span>
            <ChevronRight
              size={15}
              className="text-primary opacity-0 transition group-hover:opacity-100"
            />
          </button>
        ))}
      </Section>
    </Management>
  )
}
