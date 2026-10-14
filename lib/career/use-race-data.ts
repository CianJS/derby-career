'use client'

import { useEffect, useState } from 'react'
import { createApiClient } from '../../packages/shared/src/client'
import { createRaceDataAdapter, type RaceData } from './race-data-adapter'
import { useCareer } from './store'

const api = createApiClient({ baseUrl: '/api/server-save' })

/** A late response from another Career/mode never becomes visible. Retry is GET-only. */
export function useRaceData() {
  const { career, mode, workspace } = useCareer()
  const careerId = workspace?.career?.id
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{
    source: typeof career
    mode: typeof mode
    data: RaceData | null
    error: string | null
  } | null>(null)
  useEffect(() => {
    let active = true
    setLoaded(null)
    if (career?.raceRun && mode) {
      createRaceDataAdapter(mode, api)
        .load(career, careerId)
        .then(
          (data) => {
            if (active) {
              setLoaded({ source: career, mode, data, error: null })
            }
          },
          (error: unknown) => {
            if (active) {
              setLoaded({
                source: career,
                mode,
                data: null,
                error: error instanceof Error ? error.message : '경주 기록을 불러오지 못했습니다.',
              })
            }
          },
        )
    }
    return () => {
      active = false
    }
  }, [career, mode, careerId, attempt])
  const current = loaded?.source === career && loaded.mode === mode ? loaded : null
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    retry: () => {
      setLoaded(null)
      setAttempt((value) => value + 1)
    },
  }
}
