import { mkdir, copyFile, writeFile, rm } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { build } from 'tsup'
import { nodeFileTrace } from '@vercel/nft'

// Compile shared TS imports outside services/api into the bundle. Runtime npm dependencies
// remain external and are traced below; the root Next package is never installed.
await build({
  entry: ['src/vercel.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  splitting: false,
})
await copyFile('../../contracts/openapi.yaml', 'dist/openapi.yaml')
const { fileList } = await nodeFileTrace(['dist/vercel.js'], { base: process.cwd() })
fileList.add('dist/openapi.yaml')
const output = '.vercel/output'
const functionPath = join(output, 'functions/api.func')
await rm(output, { recursive: true, force: true })
await mkdir(functionPath, { recursive: true })
for (const file of fileList) {
  const destination = join(functionPath, file)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(resolve(file), destination)
}
await writeFile(
  join(functionPath, '.vc-config.json'),
  JSON.stringify({
    runtime: 'nodejs24.x',
    handler: 'dist/vercel.js',
    launcherType: 'Nodejs',
    shouldAddHelpers: false,
    maxDuration: 30,
  }),
)
await writeFile(
  join(output, 'config.json'),
  JSON.stringify({
    version: 3,
    routes: [{ src: '/(.*)', dest: '/api' }],
  }),
)
console.log(`Vercel Build Output v3: ${fileList.size} runtime files; raw Node request handling`)
