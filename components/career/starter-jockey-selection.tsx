'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  jockeyCatalog,
  starterJockeyOptions,
  isStarterJockeyId,
  type StarterJockeyId,
} from '@/packages/shared/src/domain'
import { careerStore, useCareer } from '@/lib/career/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function StarterJockeySelection({
  busy,
  onConfirm,
}: {
  busy: boolean
  onConfirm: (id: StarterJockeyId) => Promise<void>
}) {
  const [selected, setSelected] = useState<StarterJockeyId | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const confirm = async () => {
    if (!selected || busy || inFlight.current) {
      return
    }
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      await onConfirm(selected)
    } catch (error) {
      setError(error instanceof Error ? error.message : '초기 기수 선택을 저장하지 못했습니다.')
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }
  return (
    <section aria-labelledby="starter-jockey-title">
      <p className="ui-label text-primary">STARTER JOCKEY</p>
      <h1 id="starter-jockey-title" className="mt-3 text-3xl font-semibold">
        초기 기수를 선택하세요
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        네 후보 중 한 명을 무료로 계약합니다. 특화 각질과 관계없이 모든 전술을 사용할 수 있습니다.
      </p>
      <fieldset disabled={busy || saving} className="mt-6">
        <legend className="sr-only">초기 기수 후보 비교</legend>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {starterJockeyOptions.map(({ jockeyId, specialty }) => {
            const jockey = jockeyCatalog.find((entry) => entry.id === jockeyId)!
            return (
              <label
                key={jockeyId}
                className={cn(
                  'cursor-pointer rounded-lg border bg-card p-5 focus-within:ring-2 focus-within:ring-ring',
                  selected === jockeyId ? 'ui-selected' : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name="starter-jockey"
                  value={jockeyId}
                  checked={selected === jockeyId}
                  onChange={() => setSelected(jockeyId)}
                />
                <span className="ml-2 font-serif text-xl">{jockey.name}</span>
                <p className="mt-3 text-sm text-primary">{specialty} 특화 · 무료 계약</p>
                <p className="mt-2 text-xs text-muted-foreground">{jockey.style}</p>
                <dl className="mt-4 space-y-2 text-xs">
                  {Object.entries({
                    스타트: jockey.start,
                    '페이스 판단': jockey.pace,
                    '진로 판단': jockey.path,
                    '승부 타이밍': jockey.timing,
                    '기승 안정': jockey.stability,
                  }).map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4">
                      <dt>{label}</dt>
                      <dd className="font-semibold tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
              </label>
            )
          })}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="ui-error-state mt-4">
          {error}
        </p>
      )}
      {error && (
        <button
          type="button"
          className="mt-2 text-xs underline"
          disabled={busy || saving}
          onClick={() => void careerStore.refresh()}
        >
          선택 기록 다시 불러오기
        </button>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        선택을 저장한 뒤 육성마를 고릅니다. 기수 계약과 첫 육성 기록은 육성 시작 시 함께 확정됩니다.
      </p>
      <Button
        className="mt-5"
        disabled={!selected || busy || saving}
        onClick={() => void confirm()}
      >
        {saving ? '선택 저장 중…' : '이 기수 선택 확정'}
      </Button>
    </section>
  )
}

const serverSelectionKey = 'derby-career-server-starter-selection-v1'

/** A selection is a resumable draft; only select() creates the actual contract with the first horse. */
export function InitialJockeyGate({
  busy,
  children,
}: {
  busy: boolean
  children: (starterJockeyId?: StarterJockeyId) => ReactNode
}) {
  const snapshot = useCareer()
  const [serverSelection, setServerSelection] = useState<StarterJockeyId | null>(() => {
    try {
      const saved =
        typeof window !== 'undefined' ? sessionStorage.getItem(serverSelectionKey) : null
      return isStarterJockeyId(saved) ? saved : null
    } catch {
      return null
    }
  })
  const contracts =
    snapshot.mode === 'server'
      ? (snapshot.workspace?.stable?.contractedJockeyIds ?? snapshot.career?.contractedJockeyIds)
      : (snapshot.career?.contractedJockeyIds ?? snapshot.lifecycle?.contractedJockeyIds)
  useEffect(() => {
    if (snapshot.mode === 'server' && snapshot.workspace?.stable) {
      try {
        sessionStorage.removeItem(serverSelectionKey)
      } catch {
        // The authoritative server contract has already been saved.
      }
    }
  }, [snapshot.mode, snapshot.workspace?.stable?.id])
  // A saved empty contract list is also authoritative; never replace legacy contracts.
  if (contracts !== undefined || (snapshot.mode === 'server' && snapshot.workspace?.stable)) {
    return children()
  }
  const selection =
    snapshot.mode === 'server' ? serverSelection : snapshot.lifecycle?.starterJockeyId
  if (selection && isStarterJockeyId(selection)) {
    return (
      <>
        <p role="status" className="mb-5 text-sm text-primary">
          선택한 초기 기수: {jockeyCatalog.find((jockey) => jockey.id === selection)?.name} · 첫
          육성 시작 시 무료 계약
        </p>
        {children(selection)}
      </>
    )
  }
  return (
    <StarterJockeySelection
      busy={busy}
      onConfirm={async (id) => {
        if (snapshot.mode === 'server') {
          sessionStorage.setItem(serverSelectionKey, id)
          if (sessionStorage.getItem(serverSelectionKey) !== id) {
            throw new Error('초기 기수 선택 저장을 확인하지 못했습니다.')
          }
          setServerSelection(id)
        } else {
          await careerStore.saveLifecycle({
            ...careerStore.getSnapshot().lifecycle,
            starterJockeyId: id,
          })
        }
      }}
    />
  )
}
