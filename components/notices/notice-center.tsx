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
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelClose = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const detailTitle = useRef<HTMLHeadingElement>(null)
  const lastItem = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open || selected) {
      return
    }
    panelClose.current?.focus()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open, selected])

  useEffect(() => {
    if (!selected) {
      return
    }
    const modal = dialog.current
    modal?.showModal()
    detailTitle.current?.focus()
    return () => {
      modal?.close()
    }
  }, [selected])

  const closeDetails = () => {
    setSelected(null)
    // The list stays mounted underneath the modal, so focus returns to the selected item.
    requestAnimationFrame(() => lastItem.current?.focus())
  }
  return (
    <div ref={container} className="lab-notice-center">
      <button
        ref={trigger}
        type="button"
        aria-label="공지 및 업데이트"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-lg p-2 hover:bg-accent"
      >
        <Bell size={17} aria-hidden />
        <i aria-hidden className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
      </button>
      {open && (
        <section id={`${id}-panel`} aria-labelledby={`${id}-heading`} className="lab-notice-panel">
          <div className="lab-notice-heading">
            <div>
              <p className="ui-label text-primary">STABLE NOTICE</p>
              <h2 id={`${id}-heading`} className="mt-1 text-lg font-bold">
                공지 & 업데이트
              </h2>
            </div>
            <button
              ref={panelClose}
              type="button"
              aria-label="공지 목록 닫기"
              onClick={() => {
                setOpen(false)
                trigger.current?.focus()
              }}
              className="rounded-lg p-2 hover:bg-accent"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
          <p className="lab-notice-example">화면 확인용 임시 공지입니다.</p>
          <NoticeList
            onSelect={(notice) => {
              lastItem.current =
                document.activeElement instanceof HTMLButtonElement ? document.activeElement : null
              setSelected(notice)
            }}
          />
        </section>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-detail-title`}
        className="lab-notice-dialog"
        onCancel={(event) => {
          event.preventDefault()
          closeDetails()
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
              closeDetails()
            }
          }
        }}
      >
        {selected && (
          <>
            <div className="lab-notice-heading">
              <p className="ui-label text-primary">
                {selected.category} · {selected.date}
              </p>
              <button
                type="button"
                aria-label="공지 상세 닫기"
                onClick={closeDetails}
                className="rounded-lg p-2 hover:bg-accent"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <h2
              ref={detailTitle}
              tabIndex={-1}
              id={`${id}-detail-title`}
              className="mt-3 text-xl font-bold"
            >
              {selected.title}
            </h2>
            <p className="lab-notice-example">화면 확인용 임시 공지</p>
            <NoticeDetails notice={selected} />
            <button
              type="button"
              onClick={closeDetails}
              className="mt-6 rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent"
            >
              목록으로 돌아가기
            </button>
          </>
        )}
      </dialog>
    </div>
  )
}
