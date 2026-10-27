'use client'

import type { View } from './legacy-types'
import { SaveBackupPanel } from './save-backup-panel'
import { Management } from './management'

export function StableSettings({
  setView,
  stableName,
  country,
  mode,
  canCreate,
}: {
  setView: (view: View) => void
  stableName: string
  country: string
  mode: 'local' | 'server'
  canCreate: boolean
}) {
  return (
    <Management title="설정" eyebrow="SETTINGS" description="마방 정보와 저장 방식을 확인합니다.">
      <dl className="grid gap-4 rounded-xl border border-border p-5 text-sm sm:grid-cols-3">
        {[
          ['마방명', stableName || '등록된 이름 없음'],
          ['본거지', country],
          ['저장 방식', mode === 'local' ? '이 브라우저에 저장' : '개발용 서버에 저장'],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-2 font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        기존 마방 정보 수정 기능은 아직 제공되지 않습니다. 육성 기록과 은퇴 기록은 그대로
        유지됩니다.
      </p>
      <SaveBackupPanel mode={mode} />
      {canCreate && (
        <button
          onClick={() => setView('setup')}
          className="min-h-11 w-fit rounded-lg border border-border px-4 text-sm"
        >
          마방 최초 등록
        </button>
      )}
      <button
        onClick={() => setView('home')}
        className="min-h-11 w-fit text-sm text-primary underline"
      >
        홈으로
      </button>
    </Management>
  )
}
