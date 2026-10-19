# 코드 작성 규칙

새 코드와 수정하는 코드에 아래 최소 규칙을 적용한다. 포맷은 루트의 `.prettierrc.json`, 편집기 기본값은 `.editorconfig`를 따른다.

## 협업 브랜치와 담당 범위

- 통합 브랜치는 `develop`, Backend 개발 브랜치는 `api/develop`이다. Frontend 개발 브랜치 이름은 해당 Work의 지정을 따르며 `api/develop`에서 작업하지 않는다. 기능별 작은 PR을 `develop`에 병합한다.
- 작업 시작 전과 PR 병합 전에 최신 `develop`을 확인하고 반영한다. 다른 담당의 변경으로 코드나 검증 기준이 바뀌면 필요한 검사를 다시 실행한다.
- Backend는 `services/api`, `contracts`, `packages/shared`와 서버가 사용하는 공유 게임 계산을 담당한다. Frontend는 Next 화면·스타일·브라우저 저장·클라이언트 연동과 Sites 미리보기를 담당한다. `lib/career`는 파일별로 공유 여부를 확인하며 서버용 계산 사본을 만들지 않는다.
- 공유 계약·계산 변경은 PR에 호환성, 연동 예시와 상대 담당이 해야 할 일을 남긴다. 다른 담당의 진행 상태는 최신 원격 코드와 PR에서 확인한다.
- 리뷰 댓글과 최신 PR 커밋의 CI 성공을 확인한 뒤 병합하고, 병합 결과를 해당 개발 브랜치에 반영한다.
- 개발 브랜치를 작업 완료 후 수동 삭제하지 않는다. GitHub의 병합 후 자동 삭제가 적용되면 병합 커밋에서 같은 이름으로 복원한다.

## 기본 형식

| 항목               | 규칙                                                       |
| ------------------ | ---------------------------------------------------------- |
| 들여쓰기           | 공백 2칸                                                   |
| 문자열             | JS/TS에서 작은따옴표                                       |
| 세미콜론           | 일반 문장에서는 생략; 구문 보호가 필요하면 Prettier가 처리 |
| 줄 길이            | Prettier 기준 100자; 긴 문자열은 자동으로 분리하지 않음    |
| 여러 줄 목록       | 마지막 쉼표 사용                                           |
| 파일 인코딩·줄바꿈 | UTF-8, LF, 파일 끝 줄바꿈                                  |

## 이름과 코드

- 파일은 소문자 `kebab-case`, 함수·변수는 `camelCase`, 타입·클래스는 `PascalCase`, 고정 설정 상수는 `UPPER_SNAKE_CASE`를 사용한다. 프레임워크·도구·문서의 관례 파일명과 외부 API/DB 필드명은 원래 이름을 따른다.
- 일반 테스트는 `*.test.ts`, 별도 DB 환경의 통합 테스트는 `*.integration.ts`, SQL migration은 `001_foundation.sql`처럼 순서 번호와 설명을 사용한다.
- 재할당하지 않는 값은 `const`를 사용하고 `var`는 사용하지 않는다.
- 조건문과 반복문에는 중괄호를 사용한다. 비교는 `===`, `!==`를 사용한다.
- 사용하지 않는 변수·import를 남기지 않는다. 인터페이스상 필요한 미사용 인자는 `_` 접두어로 의도를 표시한다.
- 타입으로만 사용하는 값은 `import type` 또는 `import { type ... }`로 가져온다.
- 외부 입력은 `unknown`으로 받고 검증 후 좁힌다. `any` 예외는 외부 라이브러리 경계의 필요한 선언에만 한정하고, 해당 ESLint 주석에 이유를 적는다. 파일 전체나 여러 규칙을 일괄 해제하지 않는다.
- 같은 역할의 함수를 같은 파일에 두고 HTTP 처리, 게임 규칙, DB 접근을 구분한다. 기존 게임 계산을 서버용으로 복사하지 않는다.

## 자동 검사

자동 검사 범위는 `services/api`의 직접 작성한 JS/TS와 `packages/shared/src`, 공개 카탈로그 연동의 `app/api/event-catalog`, `app/dev/event-catalog`, `components/dev/event-catalog.tsx`, `components/dev/event-detail.tsx`, `lib/event-catalog`과 리뷰에서 수정한 게임 계산·건강·중계·경주 재생·고정 이벤트 route 및 회귀 테스트다. 정확한 파일 목록은 `services/api/eslint.config.mjs`의 `FRONTEND_FILES`를 따른다. 기존 프론트엔드는 별도 담당 범위를 유지하며, 새 코드의 기본 포맷과 이름은 위 규칙을 따른다.

개발 도구는 Node.js 22 LTS의 최신 패치 또는 Node.js 24 이상에서 실행한다. API 디렉터리에서 실행한다.

```bash
cd services/api
npm ci
npm run format
npm run lint:fix
npm run format:check
npm run lint
npm run typecheck
npm run contract:check
npm test
```

CI는 `format:check`와 `lint`를 실행하며 린트 경고도 실패로 처리한다. 코드 변경 후 검사 결과가 통과해야 한다.

`packages/shared/src/generated`의 타입과 이벤트 응답·서버 저장 검증기는 `npm run contract:generate`로 함께 갱신하고 `contract:check`로 계약 일치를 검사한다. 이벤트 Seed는 변환기로 갱신하고, 적용된 SQL migration은 체크섬을 보존하여 새 migration으로 변경한다. 이 파일들은 일괄 포맷 대상에서 제외한다.

도구 참고: [Prettier CLI](https://prettier.io/docs/cli), [typescript-eslint 설정](https://typescript-eslint.io/getting-started/).
