<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# DERBY CAREER AI 작업 시작점

## 공식 규칙 찾아가기

| 공식 원본                                       | 책임                                                     |
| ----------------------------------------------- | -------------------------------------------------------- |
| 이 문서                                         | AI 공통 작업·증거 보고 원칙                              |
| [CONTRIBUTING.md](CONTRIBUTING.md)              | 협업 브랜치·Work 담당·코딩·생성 파일 갱신·기존 검사 명령 |
| [코드 책임 지도](docs/codebase-architecture.md) | FE/BE/공유 코드의 기술적 경계와 의존 방향                |
| [병합·배포 정책](docs/release-policy.md)        | develop/main 병합 권한·사용자 승인·배포                  |
| [PR 리뷰 정책](docs/pr-review-policy.md)        | 위험도·검증 증거·독립 리뷰·수정 재검토                   |

`CLAUDE.md`는 이 문서를 참조한다. 위 규칙을 다른 도구 지침에 복제하지 않는다. 상단 Next.js 자동 생성 블록은 원문을 유지한다.

## 작업 시작

- 최신 원격 `develop`과 관련 Issue·PR을 확인하고 작업 기준 커밋을 기록한다. 브랜치와 담당 범위는 협업 규칙을 따른다.
- 수정 예정 파일, 기존 구현·계약, 영향받는 기존 검사를 먼저 확인한다.
- 이전 합의나 공식 문서에 없는 게임 규칙을 임의로 확정하지 않는다.
- 규칙이 충돌하면 기존 명시적 정책을 임의로 삭제하지 말고 충돌 근거와 미해결 사항을 기록한다. 사용자 지시가 기존 문서와 다르면 그 차이를 명시한다.

## 구현

- 실제 코드와 현재 계약을 근거로 확인한 원인을 수정한다. 관련 없는 리팩터링·중복 구현을 추가하지 않는다.
- 공유 계약·계산을 수정할 때는 협업 규칙의 호환성·상대 담당 연동 기록 절차를 따른다.
- 기존 검사를 재사용한다. 변경과 무관한 별도 QA나 같은 게임 테스트의 복제본을 만들지 않는다. 검증 우회 금지 기준은 PR 리뷰 정책을 따른다.

## 완료 보고

- 구현한 내용과 구현하지 못한 내용, 실제 실행한 명령·결과·기준 커밋을 구분한다.
- 확인한 오류, 의심되는 오류, 기존부터 존재한 오류를 구분한다. 코드·로그·테스트 근거 없이 완료·정상·해결을 주장하지 않는다.
- 미실행·실패·진행 중 검사를 성공으로 표시하지 않는다. 최신 PR 커밋의 증거를 남긴다.
- PR 생성 후 사용자 승인 전 병합 금지 원칙과 배포 제한은 병합·배포 정책을 따른다.
