# DERBY CAREER

프런트엔드는 루트의 Next.js 앱, 백엔드는 `services/api`의 Fastify/PostgreSQL 서비스다. 각 실행과 lockfile은 분리되어 있다.

## 프런트엔드 로컬 실행

Node.js 22 LTS 최신 패치 또는 24 이상과 pnpm을 사용한다.

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

백엔드 실행과 DB 초기화는 [API 실행 안내](services/api/README.md)를 따른다. Next 서버의 `.env.local`에서 `DERBY_API_URL=http://127.0.0.1:4000`을 지정한다. 실제 API 위치에 맞게 값을 바꾸고 개발 서버를 다시 실행한다. `NEXT_PUBLIC_` 접두어를 붙이지 않는다.

## 브라우저 저장과 복구

기본 모드는 `localStorage`의 `derby-career-browser-save-v1`에 육성 상태와 마방 기록을 하나의 문서로 저장한다. 은퇴 시 활성 기록 제거와 Archive 추가도 한 번에 저장한다. 기존 Career·마방 쿠키는 읽어서 이전하며 새 쿠키를 쓰거나 원본 쿠키를 삭제하지 않는다. 은퇴 표시가 있으면 이전 쿠키의 육성마를 다시 불러오지 않는다. 서버 저장으로의 이전은 포함하지 않는다.

저장 전후 검증과 Web Locks로 여러 탭의 쓰기를 조율한다. 다른 탭에서 새 커리어가 시작되면 오래된 탭의 명령을 막고, 마방 화면의 오래된 상태가 최신 능력치나 Archive를 덮어쓰지 않도록 한다. 저장 공간 부족·권한 거부·손상된 데이터는 오류로 표시하고 기록을 임의로 초기화하지 않는다. 미리보기에서 저장소 접근이 차단되면 **새 탭에서 열기**로 같은 사이트를 열어 다시 확인할 수 있다. 브라우저 데이터 삭제나 다른 기기 간 동기화는 이 모드에서 지원하지 않는다.

`tests/browser-save.test.ts`는 쿠키 차단, 저장 공간 부족, 실패한 쓰기, 기존 저장 이전, 은퇴의 원자성, 탭 충돌과 경주 로그 복구를 검사한다. `tests/game-invariants.test.ts`는 말별 84개월의 행동·이벤트·회복·달력 진행과 개발 시나리오의 경주 완료 중복 방지를 검사한다. 실제 브라우저의 권한 정책과 미리보기 안에서의 동작은 별도 확인이 필요하다.

## 로컬 서버 저장 연동

로그인 기능을 추가하지 않고 기존 개발용 세션으로 서버 저장을 검증할 수 있다. 기본 `pnpm dev`는 기존 브라우저 저장 모드다.

1. [API 실행 안내](services/api/README.md)에 따라 PostgreSQL migration·개발 Seed를 적용하고, API를 `AUTH_MODE=dev-session`, `HOST=127.0.0.1`로 실행한다.
2. `services/api`에서 `npm run session:create -- local-developer 8`로 발급한 token을 루트 `.env.local`의 `DERBY_API_DEV_SESSION_TOKEN`에 넣는다. `DERBY_API_URL`은 `http://127.0.0.1:4000` 등 루프백 HTTP 주소를 사용한다.
3. 루트에서 `pnpm dev:server-save`를 실행하고 `http://127.0.0.1:3000`에서 접속한다. 별도 포트는 `PORT` 환경변수로 설정한다.

말 생성·육성 상태 복원·훈련/휴식/치료·월 진행·서버 이벤트 선택·은퇴와 Archive 조회를 서버 기록으로 처리한다. 서버 모드는 기존 Career와 마방 쿠키를 읽거나 수정하지 않고, 브라우저 저장을 가져오지 않는다. 경주 출전·재생·완료의 v3 계약 연결은 후속 PR이며 이 모드에서는 경주 실행을 제공하지 않는다. 기존에 서버에서 출전을 확정한 Career도 로컬 경주로 우회하지 않는다.

Next `/api/server-save`는 명시적으로 켠 로컬 개발 모드에서만 열리고, 실행 명령은 Next를 `127.0.0.1`에 바인딩한다. token은 Next 서버 환경변수에만 있고 브라우저에는 전달하지 않는다. 운영 빌드에서는 저장 bridge가 항상 404다. 운영 로그인/세션 연동과 기존 저장 이관은 별도 범위다.

응답이 끊기면 화면의 **같은 요청으로 다시 확인**을 사용한다. `sessionStorage`에는 UUID와 요청 본문만 보관하며 게임 상태나 token은 저장하지 않는다. 재접속·재시도는 같은 UUID/본문으로 처리하고, 성공 응답의 과거 receipt 대신 최신 서버 workspace를 다시 조회한다. 확인되지 않은 요청이 있으면 새 저장을 막고 브라우저 저장으로 대체하지 않는다. 다른 탭에서 먼저 진행한 경우 409 뒤 최신 상태를 표시한다. 은퇴 목록은 20개씩 읽으며 마구간의 더 불러오기로 이전 기록을 조회한다.

## 공개 이벤트 조회 연동

`/dev/event-catalog`은 개발 서버에서만 열리는 DB 카탈로그 확인 화면이다. 목록·상세·발생 조건·선택지 효과를 확인하고 분류·적용 상태·활성 여부·정렬·페이지를 바꿀 수 있다. 기본 조회는 `ready` 상태의 활성 이벤트 315개다. 전체 상태와 전체 활성 여부를 선택하면 보류 이벤트 35개도 확인할 수 있다. 운영 빌드에서 확인 화면은 404를 반환한다.

연동 경로는 **브라우저 → Next `/api/event-catalog` → Fastify `/v1/events` → PostgreSQL**이다. 읽기 API는 운영 빌드에서도 제공되며 `AUTH_MODE=disabled`에서도 사용할 수 있다. Next 서버가 API에 요청하므로 브라우저용 CORS 설정이나 로그인 토큰은 필요하지 않다. 브라우저 cookie와 Authorization은 전달하지 않는다.

| Next 조회 경로                     | 응답과 사용법                               |
| ---------------------------------- | ------------------------------------------- |
| `GET /api/event-catalog`           | OpenAPI `EventList`: `{ data, pagination }` |
| `GET /api/event-catalog/{eventId}` | OpenAPI `EventDefinition`                   |

목록의 query는 `category`, `enabled`, `status`, `sort`, `order`, `page`, `pageSize`다. 허용 값과 범위는 `contracts/openapi.yaml`과 동일하다. 중복·알 수 없는 query와 잘못된 값은 400으로 거부한다. 공개 응답의 원문 body와 출처 URL은 제거하며, 내부 DB revision은 보존한다. 목록·상세 성공 응답도 OpenAPI에서 생성한 검증기로 서버와 브라우저 양쪽에서 검사한다. 목록을 한 번에 전부 내려받지 않고 서버 페이지 단위로 조회한다.

설정이 없거나 잘못되면 503 `API_NOT_CONFIGURED`, API 연결 실패나 서버 오류는 502 `CATALOG_UNAVAILABLE`, 5초 초과는 504 `CATALOG_TIMEOUT`이다. 상세 404와 요청 제한 429도 구분한다. 성공·실패 응답은 캐시하지 않고 화면에서 재시도할 수 있다. 고정 이벤트 데이터로 대체하지 않는다.

기존 `/api/events`와 월간 이벤트의 조건·효과 계약은 새 API 카탈로그와 다르다. 기존 육성 화면과 Local Save는 현재 계산을 유지하며, 조회 화면은 Career 저장을 읽거나 변경하지 않는다. 로컬 서버 저장 모드는 DB 이벤트를 별도로 표시하며, 기존 브라우저 이벤트 fixture와 함께 계산하지 않는다. 운영 로그인·기존 저장 이관·레이스 v3 지원은 후속 범위다. 카탈로그의 초기 보상은 최종 밸런스가 아닌 버전이 있는 제안치다.

## 개발 검사

[코딩 규칙](CONTRIBUTING.md)을 따른다. API 디렉터리에서 포맷·린트·API 타입·계약·테스트를 검사한다. 새 공개 카탈로그 연동 파일도 포맷과 린트 검사 범위에 포함한다.

```bash
cd services/api
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run contract:check
npm test
npm run build
```

루트 프런트엔드에서도 확인한다.

```bash
pnpm exec next typegen
pnpm exec tsc --noEmit --incremental false
node --import ./services/api/node_modules/tsx/dist/loader.mjs --test tests/*.test.ts
pnpm build
```

Next 운영 빌드는 타입 오류를 건너뛰지 않는다. 기존 v1 경주 로그는 432개 고정 digest로 확인하며, DB migration과 Seed는 리뷰 수정에서도 원본을 보존한다.
