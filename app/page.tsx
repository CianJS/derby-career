import App from '@/components/legacy-career'
import { serverSaveEnabled } from '@/lib/server-save/bridge'

export default function Page() {
  return <App saveMode={serverSaveEnabled() ? 'server' : 'local'} />
}
