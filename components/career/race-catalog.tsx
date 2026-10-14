'use client'

import { FilterMenu } from '@/components/career/filter-menu'
import { useState } from 'react'
import type { View } from './legacy-types'
import { Section } from './presentation'
import { Management } from './management'
import { races } from './legacy-catalog'

export function Races({ setView }: { setView: (v: View) => void }) {
  const [grade, setGrade] = useState('전체')
  const [track, setTrack] = useState('전체')
  const [distance, setDistance] = useState('전체')
  const [period, setPeriod] = useState('전체')
  const [country, setCountry] = useState('전체')
  const [venue, setVenue] = useState('전체')
  const [age, setAge] = useState('전체')
  const [gender, setGender] = useState('전체')
  const [major, setMajor] = useState(false)
  const [weight, setWeight] = useState('전체')
  const filtered = races.filter(
    (r) =>
      (grade === '전체' || r.grade === grade) &&
      (track === '전체' || r.track === track) &&
      (distance === '전체' || r.distance === distance) &&
      (country === '전체' || r.country === country) &&
      (venue === '전체' || r.venue === venue) &&
      (age === '전체' || r.age.includes(age)) &&
      (gender === '전체' || r.gender === gender) &&
      (weight === '전체' || weight === '정량') &&
      (!major || r.grade === 'G1'),
  )
  return (
    <Management
      title="경주 정보"
      eyebrow="RACE DATABASE"
      description="게임에 존재하는 전체 경주와 참가 조건을 조회합니다."
    >
      <div className="flex flex-wrap gap-2">
        {(
          [
            {
              label: '기간',
              value: period,
              setter: setPeriod,
              options: ['전체', '4월', '5월'],
            },
            {
              label: '마장',
              value: track,
              setter: setTrack,
              options: ['전체', '잔디', '더트'],
            },
            {
              label: '거리',
              value: distance,
              setter: setDistance,
              options: ['전체', '1400m', '1600m', '2000m'],
            },
            {
              label: '등급',
              value: grade,
              setter: setGrade,
              options: ['전체', 'G1', 'G2', 'G3'],
            },
          ] as const
        ).map(({ label, value, setter, options }) => (
          <FilterMenu
            key={label}
            label={label}
            value={value as string}
            options={options}
            onChange={setter}
          />
        ))}
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-lg border border-border bg-card px-3 py-2 text-xs text-primary">
            상세 필터
          </summary>
          <div className="absolute right-0 z-10 mt-1 grid min-w-[320px] grid-cols-2 gap-2 rounded-xl border border-border bg-popover p-3 shadow-xl">
            <FilterMenu
              label="개최국"
              value={country}
              options={['전체', '일본']}
              onChange={setCountry}
            />
            <FilterMenu
              label="경마장"
              value={venue}
              options={['전체', '한신', '나카야마', '도쿄']}
              onChange={setVenue}
            />
            <FilterMenu label="연령" value={age} options={['전체', '3세']} onChange={setAge} />
            <FilterMenu
              label="성별"
              value={gender}
              options={['전체', '수말·암말']}
              onChange={setGender}
            />
            <FilterMenu
              label="부담중량"
              value={weight}
              options={['전체', '정량', '별정']}
              onChange={setWeight}
            />
            <label className="col-span-2 flex items-center text-xs">
              <input
                type="checkbox"
                checked={major}
                onChange={(e) => setMajor(e.target.checked)}
                className="mr-2 accent-primary"
              />
              주요 경주만
            </label>
          </div>
        </details>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="hidden grid-cols-[100px_80px_70px_1fr_100px_70px_110px_110px_120px] gap-3 border-b border-border bg-accent/40 px-4 py-3 text-[10px] text-muted-foreground md:grid">
          <span>날짜</span>
          <span>국가</span>
          <span>등급</span>
          <span>경주명</span>
          <span>마장</span>
          <span>거리</span>
          <span>경마장</span>
          <span>연령·성별</span>
          <span>상금</span>
        </div>
        {filtered
          .filter((r) => period === '전체' || r.date.includes(period))
          .map((r) => (
            <button
              key={r.name}
              onClick={() => setView('race')}
              className="grid w-full gap-2 border-b border-border px-4 py-4 text-left text-xs hover:bg-accent/40 md:grid-cols-[100px_80px_70px_1fr_100px_70px_110px_110px_120px] md:items-center md:gap-3"
            >
              <span>{r.date}</span>
              <span>{r.country}</span>
              <b className="text-primary">{r.grade}</b>
              <span className="font-serif text-sm">{r.name}</span>
              <span>{r.track}</span>
              <span>{r.distance}</span>
              <span>{r.venue}</span>
              <span>
                {r.age} · {r.gender}
              </span>
              <span className="text-primary">{r.prize}</span>
            </button>
          ))}
      </div>
    </Management>
  )
}

export function Race({ setView }: { setView: (v: View) => void }) {
  return (
    <Management
      title="사츠키상"
      eyebrow="RACE DETAIL"
      description="경주의 객관적인 조건과 코스 정보를 조회합니다."
    >
      <Section eyebrow="RACE SUMMARY" title="G1 · 4월 28일">
        <div className="grid grid-cols-2 md:grid-cols-4">
          {[
            ['개최국', '일본'],
            ['경마장', '나카야마'],
            ['마장', '잔디'],
            ['거리', '2000m'],
            ['방향', '우회전'],
            ['날씨 / 마장 상태', '맑음 · 양호'],
            ['상금', '₩120,000,000'],
          ].map(([a, b]) => (
            <div key={a} className="border-b border-r border-border px-4 py-3">
              <span className="text-xs text-muted-foreground">{a}</span>
              <p className="mt-1 text-sm">{b}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="ENTRY CONDITIONS" title="참가 조건">
        <div className="grid grid-cols-2 md:grid-cols-4">
          {[
            ['연령', '3세'],
            ['성별', '수말·암말'],
            ['클래스', 'OPEN'],
            ['부담중량', '정량 57kg'],
            ['등록료', '₩1,200,000'],
          ].map(([a, b]) => (
            <div key={a} className="border-b border-border py-3">
              <span className="text-xs text-muted-foreground">{a}</span>
              <p className="mt-1 text-sm">{b}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="COURSE PROFILE" title="나카야마 잔디 2000m">
        <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
          <div>
            <p className="text-sm">우회전 · 첫 코너 진입까지 거리 짧음</p>
            <ul className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground">
              <li>직선 길이 · 310m</li>
              <li>코너 특성 · 첫 코너 진입까지 거리 짧음</li>
              <li>경사 · 고저차 약 2.2m · 마지막 구간에서 가속 요구</li>
            </ul>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">주요 요구 능력</p>
            <div className="mt-2 flex gap-2">
              <span className="border border-border px-3 py-1 text-xs">파워</span>
              <span className="border border-border px-3 py-1 text-xs">지구력</span>
            </div>
          </div>
        </div>
      </Section>
      <button onClick={() => setView('races')} className="text-xs text-primary">
        ← 경주 정보로 돌아가기
      </button>
    </Management>
  )
}
