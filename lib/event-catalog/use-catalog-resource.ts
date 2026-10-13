'use client'

import { useEffect, useState } from 'react'

type Resource<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string }

function errorMessage(body: unknown): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'object' &&
    body.error !== null &&
    'message' in body.error &&
    typeof body.error.message === 'string'
  ) {
    return body.error.message
  }
  return '이벤트를 불러오지 못했습니다. 다시 시도해 주세요.'
}

/** Reads the same-origin, contract-backed catalog. Old responses cannot replace a newer selection. */
export function useCatalogResource<T>(url: string, parse: (value: unknown) => T) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ url: string; attempt: number; resource: Resource<T> }>({
    url,
    attempt,
    resource: { status: 'loading' },
  })

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const publish = (resource: Resource<T>) => {
      if (active) {
        setResult({ url, attempt, resource })
      }
    }
    const load = async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'omit',
          headers: { Accept: 'application/json' },
        })
        const body: unknown = await response.json()
        if (!response.ok) {
          throw new Error(errorMessage(body))
        }
        publish({ status: 'ready', data: parse(body) })
      } catch (error) {
        if (!controller.signal.aborted) {
          publish({
            status: 'error',
            message: error instanceof Error ? error.message : errorMessage(null),
          })
        }
      }
    }
    void load()
    return () => {
      active = false
      controller.abort()
    }
  }, [url, attempt, parse])

  const resource: Resource<T> =
    result.url === url && result.attempt === attempt ? result.resource : { status: 'loading' }
  return { resource, retry: () => setAttempt((value) => value + 1) }
}
