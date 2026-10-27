'use client'
import { useEffect, useRef, useState } from 'react'
import { careerStore, useCareer } from '@/lib/career/store'
import {
  BACKUP_LIMIT,
  buildLocalBackup,
  captureLocalSave,
  type LocalSaveSnapshot,
} from '@/lib/career/save-backup'
import { requestBackupDownload } from '@/lib/career/backup-download'

export function SaveBackupPanel({ mode }: { mode: 'local' | 'server' }) {
  const snapshot = useCareer()
  const currentMode = useRef(mode)
  currentMode.current = mode
  const [attempt, setAttempt] = useState(0)
  const [read, setRead] = useState<{
    context: typeof snapshot
    value?: LocalSaveSnapshot
    error?: string
  } | null>(null)
  const [message, setMessage] = useState<{
    context: typeof snapshot
    error?: string
    text?: string
  } | null>(null)
  const [exporting, setExporting] = useState(false)
  const working = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    let current = true
    if (
      mode === 'local' &&
      snapshot.mode === mode &&
      snapshot.ready &&
      !snapshot.busy &&
      !snapshot.pending
    ) {
      void captureLocalSave(careerStore.getSnapshot).then(
        (value) => {
          if (current) {
            setRead({ context: snapshot, value })
          }
        },
        (error) => {
          if (current) {
            setRead({
              context: snapshot,
              error: error instanceof Error ? error.message : '저장 상태를 확인하지 못했습니다.',
            })
          }
        },
      )
    }
    return () => {
      current = false
    }
  }, [mode, snapshot, attempt])
  const current = read?.context === snapshot ? read : null
  const result = current?.value
  const notice = message?.context === snapshot ? message : null
  const blocked =
    mode !== 'local' ||
    snapshot.mode !== mode ||
    !snapshot.ready ||
    snapshot.busy ||
    snapshot.pending ||
    exporting
  async function download() {
    if (blocked || working.current || result?.status !== 'valid' || result.raceError) {
      return
    }
    working.current = true
    setExporting(true)
    setMessage(null)
    const context = snapshot
    let captured = false
    try {
      const fresh = await captureLocalSave(careerStore.getSnapshot)
      if (
        !mounted.current ||
        currentMode.current !== 'local' ||
        careerStore.getSnapshot() !== context
      ) {
        return
      }
      captured = true
      setRead({ context, value: fresh })
      if (fresh.status !== 'valid') {
        throw new Error('내보낼 통합 Local 문서가 없습니다. 저장 상태 안내를 확인해 주세요.')
      }
      if (fresh.raceError) {
        return
      }
      const backup = buildLocalBackup(fresh.raw, fresh.log, new Date().toISOString())
      requestBackupDownload(backup)
      setMessage({
        context,
        text: `리비전 ${fresh.save.revision} 사본의 다운로드를 요청했습니다. 다운로드 폴더에서 파일을 확인하세요. 파일 시각은 내보내기 시각이며 마지막 게임 저장 시각이 아닙니다.`,
      })
    } catch (error) {
      if (
        mounted.current &&
        currentMode.current === 'local' &&
        careerStore.getSnapshot() === context
      ) {
        const text = error instanceof Error ? error.message : '백업 다운로드를 시작하지 못했습니다.'
        if (!captured) {
          setRead({ context, error: text })
          setMessage(null)
        } else {
          setMessage({ context, error: text })
        }
      }
    } finally {
      working.current = false
      if (mounted.current) {
        setExporting(false)
      }
    }
  }
  return (
    <section
      aria-labelledby="save-backup-heading"
      className="min-w-0 space-y-4 rounded-xl border border-border p-5 text-sm leading-7 [overflow-wrap:anywhere]"
    >
      <h2 id="save-backup-heading" className="text-base font-semibold">
        저장 상태와 백업
      </h2>
      {mode === 'server' ? (
        <p>
          현재 개발용 서버 저장 모드입니다. Local 백업 다운로드와 원격 서버 백업 기능은 제공하지
          않습니다. 이 브라우저에 남아 있는 Local 자료는 서버 기록으로 표시하거나 내보내지 않습니다.
        </p>
      ) : (
        <>
          <p>
            이 브라우저·프로필·사이트의 Local 저장 문서를 읽기 전용으로 확인합니다. 저장 시각 필드가
            없어 마지막 저장 시각은 표시하지 않습니다.
          </p>
          {snapshot.error && (
            <p role="alert">
              현재 게임 명령 또는 저장 오류: {snapshot.error} 이 영역은 기존에 저장된 문서만 별도로
              검증하며 오류를 해제하거나 저장을 재시도하지 않습니다.
            </p>
          )}
          {snapshot.mode !== 'local' || !snapshot.ready || snapshot.busy || snapshot.pending ? (
            <p role="status">저장 상태 확인 또는 명령 처리 중입니다. 완료 후 확인할 수 있습니다.</p>
          ) : !current ? (
            <p role="status">Local 저장 문서를 검증하는 중…</p>
          ) : current.error ? (
            <p role="alert">{current.error}</p>
          ) : result?.status === 'absent' ? (
            <p role="status">
              {result.legacy === 'present'
                ? '통합 Local 문서는 없지만 이전 쿠키 저장 흔적이 있습니다. 백업에서 자동 이전하지 않습니다. 기존 게임 화면의 정상 복구 경로에서 통합 저장을 완성한 뒤 다시 확인해 주세요.'
                : result.legacy === 'unknown'
                  ? '통합 Local 문서가 없고 이전 쿠키 저장 여부도 확인하지 못했습니다. 구형 저장이 있다면 기존 게임 화면의 복구 경로를 확인해 주세요.'
                  : '통합 Local 저장 문서가 없습니다. 아직 내보낼 저장 문서가 없습니다.'}
            </p>
          ) : result?.status === 'valid' ? (
            <>
              <p role="status">통합 Local 문서 존재 · 저장 문서 검증 완료</p>
              <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                {[
                  ['저장 버전', String(result.save.version)],
                  ['리비전', `${result.save.revision} · 문서 수정 횟수이며 시각이 아님`],
                  [
                    '현재 육성마',
                    result.save.career?.horse.name ??
                      (result.save.career === null
                        ? '없음 · 육성 종료 상태 저장됨'
                        : result.save.lifecycle?.activeHorse
                          ? `${result.save.lifecycle.activeHorse.name} · 마방 스냅샷만 존재, 커리어 필드 없음`
                          : '커리어 필드 없음'),
                  ],
                  [
                    '은퇴 Archive',
                    result.save.lifecycle?.archive
                      ? `${result.save.lifecycle.archive.length}건`
                      : '필드 없음 · 미확인',
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              {result.raceError ? (
                <p role="alert">{result.raceError}</p>
              ) : (
                <p>
                  {result.log
                    ? '진행 중 경주의 저장 로그 검증 완료 · 백업에 포함합니다.'
                    : '잠긴 경주 없음 · 과거 재생 로그는 포함하지 않습니다.'}
                </p>
              )}
            </>
          ) : null}
          <p id="backup-limit" className="font-semibold">
            {BACKUP_LIMIT}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              className="min-h-11 rounded-lg border border-border px-4 disabled:opacity-50"
              disabled={blocked}
              onClick={() => {
                setMessage(null)
                setRead(null)
                setAttempt((value) => value + 1)
              }}
            >
              저장 상태 다시 확인
            </button>
            <button
              className="min-h-11 rounded-lg border border-primary px-4 text-primary disabled:opacity-50"
              aria-describedby="backup-scope backup-limit"
              disabled={blocked || result?.status !== 'valid' || !!result.raceError}
              onClick={() => void download()}
            >
              {exporting ? '백업 사본 확인 중…' : '내 Local 저장 내보내기 (.json)'}
            </button>
          </div>
          {notice?.error && <p role="alert">{notice.error}</p>}
          {notice?.text && <p role="status">{notice.text}</p>}
          <p id="backup-scope">
            문서에 실제로 저장된 마방·현재 육성마·경제 장부·기수 계약·원정·은퇴 Archive·육성
            이야기를 통째로 복사합니다. 이전에 유실되거나 저장되지 않은 기록은 복원하지 않습니다.
            게임 저장소·쿠키·세션·리비전을 변경하거나 서버로 전송하지 않습니다.
          </p>

          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>브라우저나 사이트 데이터를 삭제하면 Local Save가 사라질 수 있습니다.</li>
            <li>다른 기기·브라우저·프로필이나 시크릿 창과 자동 복원·동기화되지 않습니다.</li>
            <li>다운로드한 파일은 게임 진행 정보가 담긴 사본이므로 직접 사적으로 보관해 주세요.</li>
          </ul>
        </>
      )}
    </section>
  )
}
