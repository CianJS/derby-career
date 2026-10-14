'use client'

type Props = {
  horseName: string
  ready: boolean
  busy: boolean
  pending: boolean
  error: string | null
  blockedReason: string | null
  local: boolean
  onCancel: () => void
  onConfirm: () => void
  onRefresh: () => void
  onContinue: () => void
}

export function RetirementConfirm({
  horseName,
  ready,
  busy,
  pending,
  error,
  blockedReason,
  local,
  onCancel,
  onConfirm,
  onRefresh,
  onContinue,
}: Props) {
  return (
    <div className="lab-retirement flex min-h-[calc(100vh-57px)] items-center justify-center px-6 py-16">
      <div className="w-full max-w-md border border-border bg-card p-7" aria-busy={busy}>
        <p className="ui-label text-primary">RETIREMENT</p>
        <h1 className="mt-3 font-serif text-3xl">은퇴하시겠습니까?</h1>
        <p className="mt-5 text-sm leading-7 text-muted-foreground">
          {horseName}의 현재 커리어가 종료되고 기록은 마방 Career Archive에 저장됩니다. 은퇴 후에는
          이 말을 다시 육성할 수 없습니다.
        </p>
        {(!ready || busy || pending) && (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            {busy
              ? '은퇴 기록을 저장하는 중…'
              : pending
                ? '은퇴 요청의 저장 결과를 확인해 주세요.'
                : '육성 기록을 불러오는 중…'}
          </p>
        )}
        {blockedReason && (
          <div role="status" className="mt-4 text-sm">
            <p>{blockedReason}</p>
            <button
              type="button"
              disabled={busy || pending}
              onClick={onContinue}
              className="mt-2 text-primary underline disabled:opacity-40"
            >
              확정한 진행 이어가기
            </button>
          </div>
        )}
        {(error || pending) && (
          <div className="ui-error-state mt-4 text-sm">
            {error && <p role="alert">{error}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={onRefresh}
              className="mt-2 underline disabled:opacity-40"
            >
              {pending ? '같은 요청으로 다시 확인' : '다시 불러오기'}
            </button>
            {local && error && (
              <a href="/" target="_blank" rel="noreferrer" className="ml-3 underline">
                새 탭에서 열기
              </a>
            )}
          </div>
        )}
        <div className="mt-8 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs disabled:opacity-40"
          >
            취소
          </button>
          <button
            type="button"
            disabled={!ready || busy || pending || !!blockedReason}
            onClick={onConfirm}
            className="rounded-lg border border-rose/50 bg-rose/10 px-4 py-2 text-xs text-foreground disabled:opacity-40"
          >
            {busy ? '은퇴 저장 중…' : '은퇴 확정'}
          </button>
        </div>
      </div>
    </div>
  )
}
