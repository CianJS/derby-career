'use client'
import { useEffect, useState } from 'react'
import { createApiClient } from '../../packages/shared/src/client'
import { readCareerStory, serverStoryEntries } from '../server-save/career-story'
import { useCareer } from './store'
import { raceStory, sortStory, type CareerStory, type CareerStoryEntry } from './career-story'
import type { LifecycleHorse } from './lifecycle'

const api = createApiClient({ baseUrl: '/api/server-save' })
export function localStoryEntries(
  horse: Pick<LifecycleHorse, 'story' | 'raceRecords'> & { retiredAt?: string },
): CareerStoryEntry[] {
  const entries = new Map((horse.story?.entries ?? []).map((entry) => [entry.id, entry]))
  horse.raceRecords?.forEach((record, i) => {
    const entry = raceStory(record, i)
    if (!entries.has(entry.id)) {
      entries.set(entry.id, entry)
    }
  })
  if (horse.retiredAt && ![...entries.values()].some((entry) => entry.kind === 'retirement')) {
    entries.set('retirement', {
      id: 'retirement',
      kind: 'retirement',
      title: '은퇴',
      dateText: horse.retiredAt,
      details: ['기존 은퇴 스냅샷에 저장된 시점입니다.'],
    })
  }
  return sortStory([...entries.values()])
}
export function useCareerStory(horse: LifecycleHorse & { retiredAt?: string }, archived: boolean) {
  const snapshot = useCareer()
  const identity = archived
    ? snapshot.workspace?.retirements.find((record) => record.careerId === horse.id)?.snapshot
    : snapshot.workspace?.career?.ownedHorseId === horse.id
      ? snapshot.workspace.career
      : undefined
  const key =
    snapshot.mode === 'server' && identity
      ? `${identity.id}:${identity.revision}:${archived}`
      : null
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{
    key: string
    entries?: CareerStoryEntry[]
    error?: string
  } | null>(null)
  useEffect(() => {
    let current = true
    if (key && identity) {
      void readCareerStory(api, identity.id, archived, () => current)
        .then((data) => {
          if (data.retirement && data.retirement.snapshot.ownedHorseId !== identity.ownedHorseId) {
            throw new Error('은퇴마의 소유 말 식별자가 일치하지 않습니다.')
          }
          return serverStoryEntries(data, identity)
        })
        .then(
          (entries) => {
            if (current) {
              setLoaded({ key, entries })
            }
          },
          () => {
            if (current) {
              setLoaded({
                key,
                error:
                  '육성 이력을 조회하지 못했습니다. 서버 연결·개발용 세션과 이력 API 배포 상태를 확인해 주세요.',
              })
            }
          },
        )
    }
    return () => {
      current = false
    }
  }, [key, attempt, identity, archived])
  const localHorse = archived
    ? (snapshot.lifecycle?.archive?.find((record) => record.id === horse.id) ?? horse)
    : snapshot.lifecycle?.activeHorse?.id === horse.id
      ? snapshot.lifecycle.activeHorse
      : horse
  const story: CareerStory | undefined = snapshot.mode === 'local' ? localHorse.story : undefined
  const result = loaded?.key === key ? loaded : null
  return {
    key:
      snapshot.mode === 'local'
        ? `local:${story?.careerId ?? horse.id}`
        : (key ?? `server:unavailable:${horse.id}`),
    story,
    entries: snapshot.mode === 'local' ? localStoryEntries(localHorse) : (result?.entries ?? []),
    status:
      snapshot.mode === 'local'
        ? ('ready' as const)
        : !key
          ? ('unavailable' as const)
          : !result || snapshot.busy || snapshot.pending
            ? ('loading' as const)
            : result.error
              ? ('error' as const)
              : ('ready' as const),
    error: result?.error,
    retry: () => {
      setLoaded(null)
      setAttempt((value) => value + 1)
    },
    server: snapshot.mode === 'server',
  }
}
