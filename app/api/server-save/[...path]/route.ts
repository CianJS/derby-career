import { handleServerSave } from '@/lib/server-save/bridge'

export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  return handleServerSave(request)
}
export async function POST(request: Request) {
  return handleServerSave(request)
}
