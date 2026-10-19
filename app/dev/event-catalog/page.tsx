import { notFound } from 'next/navigation'
import { EventCatalog } from '@/components/dev/event-catalog'

export default function Page() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <EventCatalog />
}
