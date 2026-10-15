'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Bell, ChevronRight, X } from 'lucide-react'
import { updateNotices, type UpdateNotice } from '@/lib/notices/updates'

export function NoticeList({ onSelect }: { onSelect: (notice: UpdateNotice) => void }) {
  return (
    <ul className="lab-notice-list">
      {updateNotices.map((notice) => (
        <li key={notice.id}>
          <button type="button" onClick={() => onSelect(notice)} className="lab-notice-item">
            <span className="lab-notice-meta">
              {notice.category} · <time dateTime={notice.date}>{notice.date}</time>
            </span>
            <span className="lab-notice-item-title">
              {notice.title}
              <ChevronRight size={16} aria-hidden />
            </span>
            <span className="lab-notice-summary">{notice.summary}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function NoticeDetails({ notice }: { notice: UpdateNotice }) {
  return (
    <div className="lab-notice-details">
      {notice.details.map((text) => (
        <p key={text}>{text}</p>
      ))}
    </div>
  )
}

export function NoticeCenter() {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<UpdateNotice | null>(null)
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const listFocus = useRef<number | null>(null)

  useEffect(() => {
    const modal = dialog.current
    if (open) {
      modal?.showModal()
    } else if (modal?.open) {
      modal?.close()
    }
    return () => {
      if (modal?.open) {
        modal.close()
      }
    }
  }, [open])
  useEffect(() => {
    if (open) {
      const item =
        selected === null && listFocus.current !== null
          ? dialog.current?.querySelectorAll<HTMLButtonElement>('.lab-notice-item')[
              listFocus.current
            ]
          : null
      ;(item ?? title.current)?.focus()
    }
  }, [open, selected])

  const close = () => {
    setOpen(false)
    setSelected(null)
    listFocus.current = null
    trigger.current?.focus()
  }
  return (
    <div className="lab-notice-center">
      <button
        ref={trigger}
        type="button"
        aria-label="공지 및 업데이트"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(true)}
        className="relative rounded-lg p-2 hover:bg-accent"
      >
        <Bell size={17} aria-hidden />
        <i aria-hidden className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
      </button>
      <dialog
        id={id}
        ref={dialog}
        aria-labelledby={`${id}-title`}
        className={selected ? 'lab-notice-dialog' : 'lab-notice-dialog lab-notice-panel'}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') {
            return
          }
          const controls =
            event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
          const first = controls[0]
          const last = controls[controls.length - 1]
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === title.current)
          ) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }}
        onCancel={(event) => {
          event.preventDefault()
          if (selected) {
            setSelected(null)
          } else {
            close()
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const bounds = event.currentTarget.getBoundingClientRect()
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            ) {
              close()
            }
          }
        }}
      >
        {open && (
          <>
            <div className="lab-notice-heading">
              <div>
                <p className="ui-label text-primary">
                  {selected ? `${selected.category} · ${selected.date}` : 'STABLE NOTICE'}
                </p>
                <h2 ref={title} tabIndex={-1} id={`${id}-title`} className="mt-2 text-xl font-bold">
                  {selected?.title ?? '공지 & 업데이트'}
                </h2>
              </div>
              <button
                type="button"
                aria-label={selected ? '공지 상세 닫기' : '공지 목록 닫기'}
                onClick={close}
                className="rounded-lg p-2 hover:bg-accent"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <p className="lab-notice-example">화면 확인용 임시 공지입니다.</p>
            {selected ? (
              <>
                <NoticeDetails notice={selected} />
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="mt-6 min-h-11 rounded-lg border border-border px-4 text-sm hover:bg-accent"
                >
                  목록으로 돌아가기
                </button>
              </>
            ) : (
              <NoticeList
                onSelect={(notice) => {
                  listFocus.current = updateNotices.findIndex((item) => item.id === notice.id)
                  setSelected(notice)
                }}
              />
            )}
          </>
        )}
      </dialog>
    </div>
  )
}
