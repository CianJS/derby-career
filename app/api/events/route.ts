import { staticEventRepository } from '@/lib/career/events/repository'
import { eventKindLabels, type EventKind, type EventTiming } from '@/lib/career/events/types'

const timings: readonly EventTiming[] = ['month-start', 'training-result', 'rest-result']

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const kind = searchParams.get('kind')
  const timing = searchParams.get('timing')
  if (kind && !Object.hasOwn(eventKindLabels, kind)) {
    return Response.json({ error: '지원하지 않는 이벤트 유형입니다.' }, { status: 400 })
  }
  if (timing && !timings.includes(timing as EventTiming)) {
    return Response.json({ error: '지원하지 않는 이벤트 시점입니다.' }, { status: 400 })
  }
  const events = await staticEventRepository.list({
    kind: (kind as EventKind | null) ?? undefined,
    timing: (timing as EventTiming | null) ?? undefined,
  })
  return Response.json(
    { events, total: events.length },
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
  )
}
