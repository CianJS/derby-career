'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { View, CareerHorse } from './legacy-types'
import { Section } from './presentation'
import { Management } from './management'

export function Stable({
  setView,
  archive = [],
  onArchiveSelect = () => {},
}: {
  setView: (v: View) => void
  archive?: CareerHorse[]
  onArchiveSelect?: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('recent')
  // Both save modes provide newest retirements first; keep that order for ties as well.
  const filtered = archive
    .filter((horse) =>
      horse.name.toLocaleLowerCase('ko-KR').includes(query.trim().toLocaleLowerCase('ko-KR')),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, 'ko')
        : sort === 'wins'
          ? Number(b.record.match(/(\d+)승/)?.[1] ?? 0) -
            Number(a.record.match(/(\d+)승/)?.[1] ?? 0)
          : sort === 'prize'
            ? Number(b.prize.replace(/[^\d]/g, '')) - Number(a.prize.replace(/[^\d]/g, ''))
            : 0,
    )
  const select = (id: string) => {
    onArchiveSelect(id)
    setView('horseArchive')
  }
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
                onClick={() => select(horse.id)}
                data-archive-id={horse.id}
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
        <label className="flex items-center gap-2 text-sm">
          정렬
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="recent">최근 은퇴순</option>
            <option value="name">이름순</option>
            <option value="wins">통산 승수순</option>
            <option value="prize">누적 상금순</option>
          </select>
        </label>
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
        {archive.length > 0 && filtered.length === 0 && (
          <p role="status" className="py-6 text-sm text-muted-foreground">
            이름이 일치하는 은퇴 기록이 없습니다.
          </p>
        )}
        {filtered.map((horse) => (
          <button
            key={horse.id}
            data-archive-id={horse.id}
            onClick={() => select(horse.id)}
            className="group grid w-full gap-2 border-b border-border px-4 py-4 text-left last:border-0 hover:bg-accent/40 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_100px_24px] md:items-center md:gap-4"
          >
            <span className="font-serif text-base">{horse.name}</span>
            <span className="text-sm text-muted-foreground">
              {horse.age} {horse.sex}
            </span>
            <span className="text-sm">{horse.record}</span>
            <span className="text-sm">{horse.best}</span>
            <span className="text-sm text-primary">{horse.prize}</span>
            <span className="text-sm text-muted-foreground">{horse.retiredAt || '기록 없음'}</span>
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
