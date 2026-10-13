import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const api = new URL(process.env.DERBY_API_URL ?? 'http://127.0.0.1:4000')
if (
  api.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname) ||
  api.username ||
  api.password ||
  api.search ||
  api.hash ||
  api.pathname !== '/'
) {
  throw new Error('DERBY_API_URL은 로컬 API 주소여야 합니다.')
}
if (!/^[A-Za-z0-9_-]{43}$/.test(process.env.DERBY_API_DEV_SESSION_TOKEN ?? '')) {
  throw new Error('.env.local에 DERBY_API_DEV_SESSION_TOKEN을 설정해 주세요.')
}
const child = spawn(
  process.execPath,
  [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1'],
  {
    stdio: 'inherit',
    env: { ...process.env, DERBY_SAVE_MODE: 'server', DERBY_SERVER_SAVE_LOCAL: '1' },
  },
)
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.on('exit', (code) => process.exit(code ?? 1))
