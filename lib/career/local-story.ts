import { applyCareer } from './lifecycle'
import type { LifecycleSave } from './lifecycle-save'
import type { Career } from './model'
import { captureCareer, newStory, sortStory, type CareerStoryEntry } from './career-story'
import { countryName } from './local-travel'

type Document = { career?: Career | null; lifecycle?: LifecycleSave; localCareerId?: string }
/** Runs inside the one browser document commit. A failed setItem persists none of these entries. */
export function projectLocalStory(
  before: Document,
  next: Document,
  started: boolean,
): LifecycleSave | undefined {
  const career = next.career ?? before.career
  if (!career || !next.localCareerId) {
    return next.lifecycle
  }
  const retiring = next.career === null && !!before.career
  const lifecycle = next.lifecycle ?? {}
  const prior = before.lifecycle?.activeHorse
  const savedStory =
    prior?.story?.careerId === next.localCareerId && prior.story.horseId === career.horse.id
      ? prior.story
      : undefined
  let story = savedStory ?? newStory(career, next.localCareerId, started)
  if (before.career && before.localCareerId === next.localCareerId) {
    story = captureCareer(story, before.career)
  }
  story = captureCareer(story, career, before.career)
  const entries = new Map(story.entries.map((entry) => [entry.id, entry]))
  const add = (entry: CareerStoryEntry) => {
    if (!entries.has(entry.id)) {
      entries.set(entry.id, entry)
    }
  }
  const oldTrip = before.lifecycle?.travel?.activeExpedition
  const trip = next.lifecycle?.travel?.activeExpedition
  const travelChanged =
    before.lifecycle?.travel &&
    next.lifecycle?.travel &&
    next.lifecycle.travel.revision === before.lifecycle.travel.revision + 1
  if (
    travelChanged &&
    trip &&
    trip.id !== oldTrip?.id &&
    trip.careerId === next.localCareerId &&
    trip.startedTurn === career.careerTurnIndex
  ) {
    add({
      id: `departure:${trip.id}`,
      kind: 'departure',
      turn: trip.startedTurn,
      date: career.calendarDate,
      title: `${countryName(trip.targetCountry)} 원정 출발`,
      details: trip.targetRaceDefinitionId ? [`목표 경주 ID ${trip.targetRaceDefinitionId}`] : [],
    })
  }
  if (
    travelChanged &&
    oldTrip &&
    oldTrip.careerId === next.localCareerId &&
    oldTrip.id !== trip?.id
  ) {
    add({
      id: `return:${oldTrip.id}`,
      kind: 'return',
      turn: career.careerTurnIndex,
      date: career.calendarDate,
      title: `${countryName(oldTrip.targetCountry)} 원정 ${retiring ? '은퇴로 종료' : '귀국'}`,
      details: [
        retiring
          ? '은퇴 처리로 원정을 종료했습니다. 일반 귀국 명령과 구분합니다.'
          : '실제 귀국 명령으로 종료했습니다.',
      ],
    })
  }
  if (retiring) {
    const archiveId = lifecycle.lastRetiredId
    if (!archiveId || before.lifecycle?.archive?.some((horse) => horse.id === archiveId)) {
      return next.lifecycle
    }
    add({
      id: 'retirement',
      kind: 'retirement',
      turn: career.careerTurnIndex,
      date: career.calendarDate,
      title: '은퇴',
      details: ['마방에 보존된 수동 은퇴 기록입니다.'],
    })
    story = { ...story, entries: sortStory([...entries.values()]) }
    return {
      ...lifecycle,
      archive: lifecycle.archive?.map((horse) =>
        horse.id === archiveId ? { ...horse, story } : horse,
      ),
    }
  }
  story = { ...story, entries: sortStory([...entries.values()]) }
  const projected = applyCareer(
    {
      ...lifecycle,
      activeHorse: lifecycle.activeHorse ?? null,
      month: lifecycle.month ?? career.calendarDate.month,
    },
    career,
  )
  return { ...projected, activeHorse: { ...projected.activeHorse!, story } }
}
