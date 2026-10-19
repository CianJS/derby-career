import { notFound } from 'next/navigation'
import { StatePreview } from '@/components/career/state-preview'

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <StatePreview />
}
