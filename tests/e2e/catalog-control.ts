import { expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
export async function control(action: 'stop' | 'start') {
  const dir = process.env.E2E_API_CONTROL_DIR
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
