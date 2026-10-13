<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# DERBY CAREER 코드 규칙

- 코드 작성 전에 `CONTRIBUTING.md`의 최소 코딩 규칙을 읽고 따른다.
- 포맷 기준은 루트 `.prettierrc.json`과 `.editorconfig`다.
- API와 공유 코드를 변경하면 `services/api`에서 `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run contract:check`를 확인하고 변경에 필요한 기존 테스트를 실행한다.
- 자동 생성 타입, 이벤트 Seed, 이미 적용된 SQL migration은 각 생성·변경 절차로 갱신한다.
