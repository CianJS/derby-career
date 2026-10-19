import { contractedJockeys, freeAgentJockeys } from '@/lib/career/race-entry'

export const races = [
  {
    name: '한신 컵',
    date: '4월 14일',
    country: '일본',
    grade: 'G3',
    track: '잔디',
    distance: '1400m',
    venue: '한신',
    age: '3세 이상',
    gender: '수말·암말',
    prize: '₩42,000,000',
  },
  {
    name: '사츠키상',
    date: '4월 28일',
    country: '일본',
    grade: 'G1',
    track: '잔디',
    distance: '2000m',
    venue: '나카야마',
    age: '3세',
    gender: '수말·암말',
    prize: '₩120,000,000',
  },
  {
    name: 'NHK 마일컵',
    date: '5월 5일',
    country: '일본',
    grade: 'G1',
    track: '잔디',
    distance: '1600m',
    venue: '도쿄',
    age: '3세',
    gender: '수말·암말',
    prize: '₩98,000,000',
  },
  {
    name: '오사카배',
    date: '5월 12일',
    country: '일본',
    grade: 'G1',
    track: '잔디',
    distance: '2000m',
    venue: '한신',
    age: '4세 이상',
    gender: '수말·암말',
    prize: '₩110,000,000',
  },
]

export const jockeys = [...contractedJockeys, ...freeAgentJockeys].map((j) => ({
  ...j,
  meta: j.style,
  contract: '—',
  abilities: [j.start, j.pace, j.path, j.timing, j.stability],
}))

export const STABLE_CONTRACTED_JOCKEY_IDS = ['HAN_DOYUN', 'SEO_JIAN', 'YOON_TAESUNG']
