'use client'
import { useEffect, useState } from 'react'
import { createCatalogClient, startRequest, type Client, type Resource } from './client'
export function useResource<T>(key: string | null, load: (client: Client) => Promise<T>) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ key: string; attempt: number; value: Resource<T> } | null>(
    null,
  )
  useEffect(() => {
    if (key === null) {
      return
    }
    return startRequest(
      (signal) =>
        load(
          createCatalogClient('/api/racing-catalog', (url, init) =>
            fetch(url, { ...init, signal }),
          ),
        ),
      (value) => setResult({ key, attempt, value }),
    )
  }, [key, attempt, load])
  const resource: Resource<T> =
    result?.key === key && result?.attempt === attempt ? result.value : { status: 'loading' }
  return { resource, retry: () => setAttempt((value) => value + 1) }
}
