'use client'
import { useEffect, useState } from 'react'
import { createApiClient } from '../../packages/shared/src/client'
import { readServerRelations, type RelationIdentity } from './jockey-trust-presentation'
import type { JockeyRelations } from './jockey-trust'
import { useCareer } from './store'

const api = createApiClient({ baseUrl: '/api/server-save' })
/** Read-only, identity-scoped archive lookup. No current-horse fallback on failure. */
export function useArchivedRelations(id: string, saved?: JockeyRelations) {
  const { mode, workspace, busy, pending } = useCareer()
  const record =
    mode === 'server' ? workspace?.retirements.find((r) => r.careerId === id) : undefined
  const identity: RelationIdentity | null = record
    ? {
        careerId: record.careerId,
        ownedHorseId: record.snapshot.ownedHorseId,
        revision: record.snapshot.revision,
        status: 'retired',
      }
    : null
  const key = identity ? JSON.stringify(identity) : null
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{
    key: string
    data?: JockeyRelations
    error?: string
  } | null>(null)
  useEffect(() => {
    let active = true
    if (key) {
      void readServerRelations(api, JSON.parse(key)).then(
        (data) => {
          if (active) {
            setLoaded({ key, data })
          }
        },
        () => {
          if (active) {
            setLoaded({ key, error: '은퇴마 신뢰도를 조회하지 못했습니다.' })
          }
        },
      )
    }
    return () => {
      active = false
    }
  }, [key, attempt])
  const current = loaded?.key === key ? loaded : null
  return {
    data: mode === 'local' ? saved : !busy && !pending ? current?.data : undefined,
    status:
      mode === 'local'
        ? ('ready' as const)
        : !key
          ? ('unavailable' as const)
          : busy || pending || !current
            ? ('loading' as const)
            : current.error
              ? ('error' as const)
              : ('ready' as const),
    retry: () => {
      setLoaded(null)
      setAttempt((value) => value + 1)
    },
  }
}
