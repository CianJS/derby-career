import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export const FRONTEND_FILES = [
  'app/api/event-catalog/**/*.ts',
  'app/dev/event-catalog/**/*.tsx',
  'components/dev/event-catalog.tsx',
  'components/dev/event-detail.tsx',
  'lib/event-catalog/**/*.ts',
  'app/api/events/route.ts',
  'components/career/race-playback.tsx',
  'lib/career/model.ts',
  'lib/career/lifecycle.ts',
  'lib/career/health.ts',
  'lib/career/race-feed.ts',
  'tests/health.test.ts',
  'tests/lifecycle.test.ts',
  'tests/public-events.test.ts',
  'tests/race-feed.test.ts',
  'tests/race-golden.test.ts',
  'next.config.mjs',
  'app/api/server-save/**/*.ts',
  'lib/server-save/**/*.ts',
  'lib/career/store.ts',
  'components/career/server-month-event.tsx',
  'scripts/dev-server-save.mjs',
  'tests/server-save.test.ts',
]

export default defineConfig([
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'packages/shared/src/generated/**',
      'services/api/seeds/**',
    ],
  },
  {
    files: ['services/api/**/*.{js,mjs,ts}', 'packages/shared/src/**/*.ts', ...FRONTEND_FILES],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['services/api/**/*.ts', 'packages/shared/src/**/*.ts', ...FRONTEND_FILES],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  { files: FRONTEND_FILES, languageOptions: { globals: globals.browser } },
])
