# DERBY CAREER API

독립 Fastify / TypeScript / PostgreSQL 서비스다. 프론트엔드는 기존 루트 `pnpm` 실행을 유지하고, API는 이 디렉터리의 `npm` 및 별도 lockfile을 사용한다. 실제 배포·유료 서비스·운영 비밀키는 구성하지 않았다.

## 로컬 실행

Node.js 22 이상과 Docker Compose 또는 PostgreSQL 17 이상이 필요하다.

```bash
cd services/api
npm ci
cp .env.example .env
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev
```

`http://127.0.0.1:4000/health/ready`와 `GET /v1/events?category=common&enabled=true`로 확인한다. `db:seed`는 기존 playable 코드의 말 3두·기수 6명·경주 17개와 실제 Notion 이벤트를 넣는다. 말/기수/경주는 `development_fixture`로 명시하며 운영 환경에서 `db:seed`는 거부한다. 이벤트만 가져오려면 `npm run events:import -- seeds/events.catalog.json`을 사용한다.

빌드 후 실행도 독립적으로 가능하다.

```bash
npm run build
npm start
```

Docker 빌드는 공유 순수 함수를 포함해야 하므로 **저장소 루트**에서 실행한다.

```bash
docker build -f services/api/Dockerfile -t derby-career-api .
```

실행 컨테이너에 `DATABASE_URL`을 전달하고, 실행 전 별도 작업으로 `node dist/cli.js migrate`를 적용한다. 서버는 자동 마이그레이션·자동 seed를 하지 않는다. `AUTH_MODE=disabled`인 운영 이미지에서는 공개 카탈로그만 제공한다.

## 인증과 저장 권한

기본 `.env`의 `AUTH_MODE=disabled`에서는 모든 Career API가 `503 AUTH_NOT_CONFIGURED`를 반환한다. Career 조회도 소유자 인증이 필요하며 공개되지 않는다.

로컬에서 서버 Career를 검증하려면 `.env`의 `AUTH_MODE`를 `dev-session`으로 바꾸고 다음 명령으로 세션을 발급한다.

```bash
npm run session:create -- local-developer 8
```

명령은 `{principalId, token, expiresAt}`을 반환한다. 반환한 token을 `Authorization: Bearer <token>`으로 전달한다. 256비트 난수 토큰의 SHA-256 해시만 DB에 저장하며 만료·폐기를 검사한다. 발급 HTTP API, 고정 공용 키, 클라이언트 `ownerId`는 없다. 동일 subject로 다시 발급하면 동일 소유자의 데이터에 접근한다.

폐기 시 토큰을 셸 인수에 넣지 않고 `DEV_SESSION_TOKEN` 환경변수로 전달한 뒤 `npm run session:revoke`를 실행한다. `NODE_ENV=production`, 비루프백 listen 주소, 비루프백 요청에서는 개발 세션을 거부한다. proxy header는 신뢰하지 않는다. 브라우저 CORS 출처는 `CORS_ORIGINS`의 명시적 목록만 허용한다.

운영 API는 외부 로그인 서비스가 발급한 API 전용 JWT를 검증하는 `oidc-jwt` 모드를 지원한다. 로그인 화면·OAuth callback·토큰 발급/갱신·서비스 계정 연결은 이 API에서 제공하지 않는다. 개발 세션을 운영 인증으로 활성화하는 우회 옵션은 없다.

```dotenv
AUTH_MODE=oidc-jwt
OIDC_ISSUER=https://identity.example.invalid
OIDC_AUDIENCE=derby-career-api
OIDC_JWKS_URL=https://identity.example.invalid/.well-known/jwks.json
OIDC_TOKEN_TYPE=at+jwt
OIDC_MAX_TOKEN_AGE_SECONDS=3600
```

예시 주소 대신 선택한 로그인 공급자의 정확한 issuer, 신뢰하는 HTTPS JWKS 주소, **이 API를 위한** audience를 설정한다. issuer와 JWKS URL에 사용자 정보·fragment를 넣을 수 없고 issuer에는 query도 허용하지 않는다. 필수 설정이 빠지거나 잘못되면 시작을 거부한다. 운영에서 `HOST=0.0.0.0`으로 사용할 수 있으며 외부 서비스·TLS·비밀키·유료 계정은 이번 구현에서 생성하지 않았다.

`Authorization: Bearer <token>`의 RS256 또는 ES256 서명과 `iss`, `aud`, `sub`, `iat`, `exp`를 검증한다. 미래의 `nbf`/`iat`, 만료, 최대 token age(60~3600초, 기본 3600초)를 확인하며 시각 오차 5초만 허용한다. 기본 `typ`은 `at+jwt`다. 공급자가 API 전용 session JWT를 발급하면 `OIDC_TOKEN_TYPE=JWT`를 명시한다. 로그인용 ID token의 client ID를 이 API의 audience로 사용하지 않는다. 공급자의 토큰 수명·클라이언트 갱신 주기는 최대 token age와 맞춘다.

서버는 검증된 `issuer + sub`의 해시를 `external` principal에 매핑한다. 토큰 재발급·이메일 변경에도 같은 사용자의 저장을 유지하고, 다른 발급자의 같은 sub와 같은 이메일을 가진 다른 사용자, 기존 개발 세션의 저장은 합치지 않는다. 요청 body나 추가 JWT claim의 `ownerId`·역할·이메일로 저장 권한을 변경하지 않는다. 검증되지 않은 토큰은 principal·Career·receipt를 만들지 않는다. 운영 JWT를 앱의 `sessions` 테이블이나 브라우저 Local Save에 저장하지 않는다.

토큰 문제는 `401 UNAUTHORIZED`와 `WWW-Authenticate: Bearer`, JWKS 연결 실패·timeout·redirect·잘못된 키 응답은 `503 AUTH_PROVIDER_UNAVAILABLE`다. 공급자의 원문 오류와 토큰은 응답에 넣지 않는다. JWKS는 고정된 설정 주소로만 요청하며 token의 `jku`·`jwk`를 신뢰하지 않는다. 키 cache는 5분, 알 수 없는 kid의 재조회 cooldown은 30초, 요청 timeout은 2초다. cache 안의 신뢰하는 키는 계속 검증에 사용할 수 있다. 공개 카탈로그는 인증 없이 조회할 수 있다.

즉시 로그아웃/계정 차단/refresh token 폐기는 공급자 연동에서 처리해야 한다. 이미 발급한 JWT는 expiry 또는 서버의 최대 나이에 도달할 때까지 유효하며 실시간 introspection·폐기 목록은 아직 없다. 공급자별 로그인 연동과 여러 인스턴스가 공유하는 요청 제한은 후속 범위다. 기본 `AUTH_MODE=disabled`는 계속 Career API를 503으로 닫는다.

검증 구현은 [`jose` 공식 API](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md)와 [JWT 검증 기준 RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html)를 따른다. 서명 검증·공개키 교체 처리를 서버용으로 직접 복제하지 않는다.

## 계약과 연동

`contracts/openapi.yaml`이 HTTP 계약의 기준이다. 서버는 이 파일로 요청을 검증하고 응답을 직렬화하며, 공유 타입과 공개 이벤트·서버 저장 요청/응답 검증기도 여기서 생성한다.

```bash
npm run contract:generate
npm run contract:check
```

계약을 변경할 때 YAML과 `packages/shared/src/generated/api.ts`를 함께 커밋한다. 공개 이벤트는 Next `/api/event-catalog`과 개발용 `/dev/event-catalog` 화면에서 조회할 수 있다. 루트의 `.env.local`에 서버 전용 `DERBY_API_URL`을 설정한다. 로컬 서버 저장 모드는 기존 육성 페이지·store에서 별도 서버 경로로 실행하고, Local Save를 읽거나 이전하지 않는다. 실행 방법과 오류 규칙은 루트 `README.md`를 따른다. 루트 `tsconfig.json`의 서비스/패키지 제외는 API의 독립 타입 검사를 위한 설정이다. `pnpm dev:server-save`가 로컬 서버 저장 실행 명령이고 기존 `pnpm dev`와 pnpm lockfile은 유지한다.

프론트엔드에서 안전하게 시작할 연동은 공개 카탈로그 Adapter다.

```ts
import { createEventCatalogAdapter } from '@/packages/shared/src/event-catalog-adapter'

const events = createEventCatalogAdapter('http://127.0.0.1:4000')
const page = await events.list({ category: 'common', enabled: true, page: 1, pageSize: 20 })
const detail = await events.detail('COM-0001')
```

`createApiClient`에는 권한이 있는 Career 메서드도 있다. 서버 Career를 선택한 화면은 반환된 `career.state`만 표시·사용해야 한다. Local Save와 서버 상태를 병행 계산·동시 authoritative 저장으로 사용하지 않는다. Adapter는 local storage, cookie, 기존 브라우저 저장을 읽거나 수정하지 않는다. 운영 호출은 `getSessionToken`에서 공급자의 최신 API 전용 JWT를 반환한다. 로컬 서버 저장 모드는 Next 서버의 기존 dev-session으로 연결한다. 운영 로그인 공급자·토큰 갱신·저장 이관·Frontend 경주 bridge와 화면 연동은 별도 범위이며, 운영 bridge로 개발 세션을 노출하지 않는다.

`GET /v1/careers/workspace?page=1&pageSize=20`은 인증된 소유자의 현재 마방 자금/세계 날짜, 활성 Career 또는 null, 현재 월의 `confirmedActionId` UUID, 페이지 단위 은퇴 snapshot과 pagination을 일관된 읽기 transaction으로 반환한다. 활성 말이 없어도 마방과 은퇴 기록을 복원할 수 있다. 은퇴 snapshot의 자금/날짜는 당시 값을 유지하고 마방 자금은 현재 값이다. 조회는 캐시하지 않는다.

주요 요청 ID 규칙:

| 작업                | 유지해야 할 UUID                 | 동작                                           |
| ------------------- | -------------------------------- | ---------------------------------------------- |
| Career 생성         | `careerId`                       | 동일 본문 재시도는 기존 응답 재생              |
| 월간 행동           | `actionId`                       | 같은 월 다른 ID/행동은 409                     |
| 이벤트 선택·다음 월 | `commandId`                      | 같은 ID 다른 본문은 409                        |
| 출전 확정           | `raceRunId`                      | Seed·입력·로그 잠금                            |
| 경주 완료           | `commandId` + 저장된 `raceRunId` | 다른 commandId로 재호출해도 상금·월 진행 1회   |
| 수동 은퇴           | `commandId`                      | 같은 ID·본문만 최초 응답 재생, 다른 요청은 409 |

API `actionId`는 UUID이며 `career.state.action.actionId`의 기존 도메인 문자열과 다르다. 다음 월 요청에는 행동 API가 반환한 UUID를 사용한다. 생성형 AI 호출, 클라이언트 state/result/seed 업로드, 결과 재추첨 API는 없다. 재시도에는 최초 요청 ID와 본문을 그대로 유지하고 현재 상태는 GET으로 다시 조회한다.

## 서버 레이스

신규 출전은 기존 공유 `simulateRace`를 통해 `lib/career/race-sim-v3.ts`를 사용한다. 엔진을 생략하면 **v3**이며, `engineVersion: 'race-sim-v1'` 또는 `'race-sim-v2'`도 계속 지원한다. 적용 전 `npm run db:migrate`로 **004 migration**을 실행한다. `/health/ready`는 이 migration까지 요구하며, 기존 001~003의 체크섬과 저장 기록은 변경하지 않는다.

| 메서드와 경로                                                | 공유 클라이언트       | 반환 데이터                                                                                             |
| ------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /v1/careers/{careerId}/race-entries`                    | `getRaceEntryOptions` | 현재 Career, 기본 엔진, 현재 월 DB 경주별 `eligible`/`restrictionReason`, 계약 기수의 현재 호흡도, 전술 |
| `POST /v1/careers/{careerId}/race-entries`                   | `enterRace`           | 잠긴 `raceRunId`와 Career                                                                               |
| `GET /v1/careers/{careerId}/race-runs/{raceRunId}`           | `getRaceRun`          | RaceRun, 출전 당시 건강, 엔진·digest·로그 크기 metadata                                                 |
| `GET /v1/careers/{careerId}/race-runs/{raceRunId}/log`       | `getRaceLog`          | 원본 Simulation Log와 최종 결과                                                                         |
| `POST /v1/careers/{careerId}/race-runs/{raceRunId}/complete` | `completeRace`        | 저장된 최종 결과와 경주 후 Career                                                                       |

출전 조회는 상태·Seed를 만들지 않는다. 전체 `restrictionReason`과 각 경주의 `eligible`을 확인하고, 조회된 계약 기수와 전술 중에서 선택한다. 출전 본문은 `{ raceRunId, raceDefinitionId, jockeyId, tactic, expectedTurn, engineVersion? }`이며 `expectedTurn`은 조회된 `career.state.careerTurnIndex`다. 서버는 확정 시 다시 검증한다. 확정 후 다른 Race/Jockey/Tactic/Engine Version이나 새로운 RaceRun ID로 같은 달 출전을 요청하면 409다. 클라이언트 Seed/Snapshot/결과 업로드는 400이다.

Run의 `engineVersion: 'entry-contract-v1'`은 **입력 계약 버전**이다. 실제 시뮬레이션 버전은 `raceRun.simulation.engineVersion`, metadata 및 Log의 `engineVersion`에 있다. 재생에 사용하는 `RaceRunInput`/`RaceSimulationLog` 구조는 유지한다. 생성 타입은 기존 OpenAPI의 길이 제약을 반영해 적성 쌍을 `[string, string]`으로 생성하므로 게임 타입에 직접 전달할 수 있다. `save-validation.mjs`의 `validateEnterRace`, `validateCompleteRace`, `validateRaceEntryOptions`, `validateRaceEntryResponse`, `validateRaceRunResponse`, `validateRaceLogResponse`, `validateRaceCompleteResponse`로 외부 JSON을 검사한다.

완료 본문은 `{ commandId }`다. 완료는 저장된 결과로 전적·상금·건강 변화·기승 횟수를 한 번 반영하고 **다음 월까지 진행**한다. 이후 `months/advance`를 추가 호출하지 않는다. 같은 완료 ID는 최초 receipt를 반환하고, 새 완료 ID로 이미 끝난 경주를 요청하면 저장 결과와 현재 Career를 반환한다. 예전 출전·완료 receipt의 Career는 당시 상태이므로 화면 복원에는 최신 `getCareerWorkspace`를 사용한다. 재시도는 ID와 본문을 그대로 유지하며, 과거에 엔진을 생략한 요청에는 새 엔진 필드를 추가하지 않는다.

Frontend의 서버 저장 controller/journal, Next bridge의 경주 경로 및 Playback의 서버 Log 로딩은 Frontend Work에서 연결해야 한다. 이 PR은 기존 `ServerSaveCommand`의 종류나 브라우저 저장을 바꾸지 않는다. 유료 출전, 호흡도 성장 및 정식 경주/후보 데이터는 기존 제한을 유지한다.

## 서버 은퇴

`POST /v1/careers/{careerId}/retirement`에 `{ commandId, expectedRevision }`을 전달한다. `expectedRevision`은 직전에 조회한 `career.revision`이다. 미완료 경주·행동, 변경된 revision, 이미 은퇴한 Career는 409다. 완료된 훈련·휴식·치료 결과가 있는 월에도 은퇴할 수 있으며 다음 월로 진행하지 않는다. 동일 commandId와 본문의 재시도는 최초 응답을 반환한다. 다른 본문이나 명령에 같은 ID를 재사용할 수 없다.

응답은 `{ career, retirement }`다. `career.status`를 `retired`로 변경하고 revision을 1 증가시키며, 은퇴 snapshot과 명령 receipt를 같은 트랜잭션으로 저장한다. 실패하면 모두 롤백한다. 능력·건강·전적·자금·세계 날짜·이벤트 기록은 그대로 보존한다. 미선택 이벤트와 사용하지 않은 이벤트 보정도 당시 상태로 보존하며 추가 선택이나 효과 적용은 없다. 클라이언트 snapshot과 은퇴 사유는 받지 않으며 서버가 사유를 `manual`로 기록한다. 자동 은퇴 조건은 추가하지 않았다.

`GET /v1/careers/{careerId}/retirement`는 `{ retirement }`를 반환한다. `retirement`에는 `careerId`, `reason`, 실제 저장 시각인 `retiredAt`(UTC), 게임 세계 날짜인 `retiredOn`, 은퇴 당시의 `snapshot`이 있다. snapshot의 자금과 날짜는 이후 마방의 새 Career가 진행되어도 바뀌지 않는다. 기존 `GET /v1/careers/{careerId}`는 현재 마방 자금을 포함하므로 은퇴 당시 정보는 은퇴 조회의 snapshot을 사용한다. 활성 Career, 없는 Career, 다른 소유자의 기록은 404다.

은퇴 후 기존 조회·이력은 유지하고 새로운 쓰기는 409로 거부한다. 기존 명령을 같은 ID·본문으로 재시도하면 과거 receipt만 재생하므로 과거 응답의 status로 현재 상태를 덮어쓰지 말고 GET으로 확인한다. 새 Career는 기존 마방·자금·세계 날짜를 이어받고 새 소유 말 UUID를 사용한다. 은퇴 확정과 조회 모두 기존 소유자 인증이 필요하며 운영 인증 미설정 상태에서는 503이다. 공유 클라이언트의 `retireCareer`와 `getRetirement`로 호출할 수 있다. 기존 Local Save 화면은 이 API에 연결하지 않았다.

## DB와 도메인

버전별 SQL 파일을 하나의 migration runner로 실행한다. 트랜잭션·advisory lock·적용 체크섬을 사용한다. 적용된 migration은 수정하지 않고 새 파일을 추가한다. destructive down migration은 제공하지 않는다.

Career의 `state`는 기존 순수 도메인이 사용하는 authoritative aggregate이며 능력·건강도 여기에 있다. 별도 복제 계산용 stats 테이블은 만들지 않았다. 소유 말은 고유 UUID와 정의 FK를 가지며 Career·월간 행동·경주 결과·기수 관계는 이 UUID를 참조한다. 마방 자금·계약·세계 시간은 stable에 있다. 서버 은퇴는 기존 `career_records` 테이블과 수정·삭제 방지 trigger를 사용하므로 추가 migration 없이 immutable snapshot을 보존한다.

월간 명령은 principal → Career 순으로 잠그고 월당 행동 UNIQUE, 소유권 FK, 입력 해시, 불변 응답 receipt를 함께 저장한다. 성장·이벤트·기록·상금은 같은 트랜잭션으로 반영한다. RaceRun·시뮬레이션 로그·결과·상금 ledger·은퇴 snapshot은 SQL trigger로 수정/삭제를 막는다. 이벤트 선택과 완료된 행동도 변경할 수 없다.

`packages/shared/src/domain.ts`는 `lib/career`의 기존 순수 함수만 재내보낸다. `server-domain.ts`는 이 함수들을 사용하면서 브라우저 fixture 이벤트를 등록하지 않는다. 서버 이벤트의 행동 보정도 이 순수 함수의 0/1000 제한 전에 적용하며, 제한된 결과에서 기본 성장·회복량을 역산하지 않는다. 서버 이벤트는 별도 envelope/DB로만 관리하고, 성장·치료·회복·기본 이벤트 성장/비용 계산은 최신 공유 함수로 처리한다. 서버용 계산 사본이나 새로운 v3 엔진을 작성하지 않았다.

API와 Frontend의 신규 경주는 기존 공유 **`race-sim-v3`**를 사용한다. v1/v2 계산 및 로그도 유지하며, 엔진의 밸런스 수치와 계산식은 변경하지 않는다. 로그는 모든 버전에서 **원본 JSON 문자열과 JSONB**를 함께 저장하고 원본 필드 순서로 반환한다. 새로고침·재요청·완료와 DB 카탈로그 변경에서 저장 결과를 재시뮬레이션하지 않는다.

건강은 공유 `health.ts`의 정상·경상·중등도 부상 및 기존 별칭을 지원하고 중상·중증을 차단한다. 실제 건강과 `healthRecovery`를 Snapshot 및 응답에 보존한다. 최신 v0의 회복·경주 후 건강 규칙은 공유 `BALANCE.health`와 순수 함수를 사용하며 서버가 별도 부상 배율·악화 확률을 추가하지 않는다. v1.4 문서와 현재 playable의 세부 수치 차이는 별도 밸런스 조율이 필요하다. 유료 등록비 출전 제한, 후보 fixture, age 갱신 방식, 운영 후보 생성은 후속 공유 도메인 작업이다. 경주 상금은 저장된 Log 그대로 마방/말 기록에 한 번만 반영하며 호흡도 성장 규칙을 임의로 추가하지 않는다.

## 검증

코딩 규칙은 저장소 루트의 `CONTRIBUTING.md`를 따른다. 개발 도구는 최신 Node.js 22 LTS 패치 또는 Node.js 24 이상에서 사용한다. API와 공유 코드의 포맷은 `npm run format`, 자동 수정 가능한 린트 항목은 `npm run lint:fix`로 정리한다.

```bash
npm run format:check
npm run lint
npm run typecheck
npm run contract:check
npm test
npm run build
```

SQL 통합 검증은 PGlite의 실제 PostgreSQL 엔진으로 migrations/FK/trigger/rollback/멱등성/계약을 확인한다. PGlite는 테스트 의존성이며 앱 저장소의 대체 구현이 아니다. 별도 PostgreSQL 다중 연결 검증에는 `TEST_DATABASE_URL`로 전용 `*_test` DB를 지정한 뒤 `npm run test:postgres`를 실행한다. `.github/workflows/backend-foundation.yml`은 PostgreSQL 17, 동시 요청, 빌드된 HTTP 서버까지 검증한다. 테스트는 운영 DB에 연결하지 않는다.

기존 프론트엔드 검증은 저장소 루트의 `pnpm build`와 기존 `tests/*.test.ts`다. 이번 변경에는 UI 전환이나 화면 검증이 포함되지 않는다.
