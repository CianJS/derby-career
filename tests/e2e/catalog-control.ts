import { expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
async function requestControl(action: 'stop' | 'start' | 'restart', dir?: string) {
  expect(dir, 'Use the isolated run-browser-e2e runner').toBeTruthy()
  const id = randomUUID()
  const path = join(dir!, 'request.json')
  await writeFile(path + '.tmp', JSON.stringify({ id, action }))
  await rename(path + '.tmp', path)
  let response: { id?: string; ok?: boolean; error?: string } = {}
  await expect
    .poll(async () => {
      try {
        response = JSON.parse(await readFile(join(dir!, 'response.json'), 'utf8'))
      } catch {
        return null
      }
      return response.id
    })
    .toBe(id)
  expect(response.ok, response.error).toBe(true)
}

export function control(action: 'stop' | 'start' | 'restart') {
  return requestControl(action, process.env.E2E_API_CONTROL_DIR)
}

/** Reset only the ephemeral save API process, retaining its real DB/session and Next server. */
export function restartSaveApi() {
  return requestControl('restart', process.env.E2E_SERVER_CONTROL_DIR)
}
