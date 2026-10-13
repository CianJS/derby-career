import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'

const fix = process.argv.includes('--fix')
const eslint = new ESLint({
  cwd: fileURLToPath(new URL('../../../', import.meta.url)),
  overrideConfigFile: fileURLToPath(new URL('../eslint.config.mjs', import.meta.url)),
  fix,
})
const results = await eslint.lintFiles([
  'services/api/src/**/*.{js,mjs,ts}',
  'services/api/scripts/**/*.{js,mjs,ts}',
  'services/api/tests/**/*.{js,mjs,ts}',
  'services/api/eslint.config.mjs',
  'packages/shared/src/**/*.ts',
])
if (fix) {
  await ESLint.outputFixes(results)
}
const formatter = await eslint.loadFormatter('stylish')
const messages = formatter.format(results)
if (messages) {
  process.stderr.write(messages)
}
if (results.some((result) => result.errorCount > 0 || result.warningCount > 0)) {
  process.exitCode = 1
} else {
  console.log(`Lint passed (${results.length} files)`)
}
