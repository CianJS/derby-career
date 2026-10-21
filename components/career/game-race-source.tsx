import type { RaceDefinitionSnapshot } from '@/lib/career/race-entry'

type GameRace = Pick<RaceDefinitionSnapshot, 'id' | 'name'>

/** Display metadata only. Never changes the definition or assumes an unmarked race is official. */
export const gameRaceSource = (id: string) =>
  id.startsWith('DEV_') ? '게임용 임시 경주' : '게임 출전 경주'

export const gameRaceOption = (race: GameRace) => `${race.name} · ${gameRaceSource(race.id)}`

export function GameRaceSource({ raceId }: { raceId: string }) {
  return <span className="lab-chip ml-1 font-sans font-normal">{gameRaceSource(raceId)}</span>
}

export function GameRaceSources({ races }: { races: readonly Pick<GameRace, 'id'>[] }) {
  const sources = [...new Set(races.map((race) => gameRaceSource(race.id)))]
  return sources.map((source) => (
    <span key={source} className="lab-chip ml-1 font-sans font-normal">
      {source}
    </span>
  ))
}

export function GameRaceDisclosure() {
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      ‘게임용 임시 경주’는 공식 개최 경주가 아닌 게임 시뮬레이션용 경기입니다. 출전·원정에 이용할 수
      있으며, 공식 참고 경주 도감과는 별개입니다.
    </p>
  )
}
