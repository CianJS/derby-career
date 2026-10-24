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
import { jockeyAbilities, tacticDescriptions, starterComparison } from './starter-jockey-guidance'

export function StarterJockeySelection({
  busy,
  onConfirm,
  initialSelected = null,
  onCancel,
}: {
  busy: boolean
  onConfirm: (id: StarterJockeyId) => Promise<void>
  initialSelected?: StarterJockeyId | null
  onCancel?: () => void
}) {
  const [selected, setSelected] = useState<StarterJockeyId | null>(initialSelected)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    title.current?.focus()
  }, [])
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
      <h1
        ref={title}
        tabIndex={-1}
        id="starter-jockey-title"
        className="mt-3 text-3xl font-semibold"
      >
        초기 기수를 선택하세요
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        아직 육성마를 선택하지 않았습니다. 네 후보 중 한 명을 초안으로 선택한 뒤 말의 실제 적성을
        비교합니다. 모든 기수는 네 전술을 모두 사용할 수 있습니다. 특화는 강점이며 전술 선택 제한이
        아닙니다.
      </p>
      <details className="mt-4 rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          기수 능력치 5가지 알아보기
        </summary>
        <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
          {jockeyAbilities.map(({ key, label, description }) => (
            <div key={key}>
              <dt className="font-semibold">{label}</dt>
              <dd className="mt-1 text-muted-foreground">{description}</dd>
            </div>
          ))}
        </dl>
      </details>
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
                <p className="mt-2 text-xs text-muted-foreground">
                  {tacticDescriptions[specialty]}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">{jockey.style}</p>
                <p className="mt-3 text-xs leading-relaxed">{starterComparison(jockeyId)}</p>
                <dl className="mt-4 space-y-2 text-xs">
                  {jockeyAbilities.map(({ key, label, description }) => (
                    <div key={label} className="flex justify-between gap-4">
                      <dt>
                        {label}
                        <span className="sr-only"> · {description}</span>
                      </dt>
                      <dd className="font-semibold tabular-nums">{jockey[key]}</dd>
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
        이 단계는 초안 저장입니다. 실제 무료 계약 1명과 첫 육성 기록은 ‘이 말로 육성 시작’ 시 함께
        확정됩니다. 다른 기수는 추후 영입 예정이며, 어떤 기수도 모든 말·경주에서 최적임을 보장하지
        않습니다.
      </p>
      <Button
        className="mt-5"
        disabled={!selected || busy || saving}
        onClick={() => void confirm()}
      >
        {saving ? '선택 저장 중…' : '이 기수 선택 확정'}
      </Button>
      {onCancel && (
        <Button
          variant="outline"
          className="ml-3 mt-5"
          disabled={busy || saving}
          onClick={onCancel}
        >
          기수 변경 취소
        </Button>
      )}
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
  const [editing, setEditing] = useState<{ expected: StarterJockeyId } | null>(null)
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
  if (selection && isStarterJockeyId(selection) && !editing) {
    return (
      <>
        <p role="status" className="mb-5 text-sm text-primary">
          선택한 초기 기수: {jockeyCatalog.find((jockey) => jockey.id === selection)?.name} · 첫
          육성 시작 시 무료 계약
        </p>
        <Button
          className="mb-3"
          variant="outline"
          disabled={busy}
          onClick={() => setEditing({ expected: selection })}
        >
          기수 변경
        </Button>
        <p className="mb-5 text-xs text-muted-foreground">
          기수를 변경하면 육성마를 다시 선택해야 합니다. 마방 소속 국가도 다시 확인해 주세요. 아직
          계약은 확정되지 않았습니다.
        </p>
        {children(selection)}
      </>
    )
  }
  return (
    <StarterJockeySelection
      busy={busy}
      initialSelected={editing?.expected ?? null}
      onCancel={editing ? () => setEditing(null) : undefined}
      onConfirm={async (id) => {
        const expected = editing?.expected ?? (isStarterJockeyId(selection) ? selection : undefined)
        if (snapshot.mode === 'server') {
          const saved = sessionStorage.getItem(serverSelectionKey)
          if ((isStarterJockeyId(saved) ? saved : undefined) !== expected && saved !== id) {
            throw new Error('초기 기수 선택이 변경되었습니다. 선택 기록을 다시 확인해 주세요.')
          }
          sessionStorage.setItem(serverSelectionKey, id)
          if (sessionStorage.getItem(serverSelectionKey) !== id) {
            throw new Error('초기 기수 선택 저장을 확인하지 못했습니다.')
          }
          setServerSelection(id)
        } else {
          await careerStore.saveLifecycle(
            {
              ...careerStore.getSnapshot().lifecycle,
              starterJockeyId: id,
            },
            { expectedStarterJockeyId: expected },
          )
        }
        setEditing(null)
      }}
    />
  )
}
