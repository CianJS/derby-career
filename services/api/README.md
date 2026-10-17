# DERBY CAREER API

독립 Fastify / TypeScript / PostgreSQL 서비스다. 프론트엔드는 기존 루트 `pnpm` 실행을 유지하고, API는 이 디렉터리의 `npm` 및 별도 lockfile을 사용한다. 실제 배포·유료 서비스·운영 비밀키는 구성하지 않았다.

Vercel 공개 카탈로그 배포는 [배포 설정·DB 준비·검증 절차](docs/vercel-deployment.md)를 따른다. `services/api/vercel.json`은 기존 Frontend 프로젝트 설정과 별개다. API 전용 대상 및 환경 DB를 승인한 후 적용하며 운영 배포/DB 변경은 자동으로 실행하지 않는다.

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

## 이벤트 확장 사전 검증

신규 Notion 650개는 `seeds/events.drafts.import.json`의 공개 게임 속성으로만 보존한다. `npm run events:check -- <input> <report.json> <drafts.json>`은 조건·효과를 독립 검사하고 실행 내용이 없는 비활성 packet을 만든다. 기존 공통 350개는 기본 Seed에 그대로 남으며 신규 packet은 일반 `events:import`와 `db:seed`로 적용되지 않는다.

격리 packet의 명시적 DB 적용은 `npm run events:import-drafts -- <drafts.json>`이다. 활성화·기존 검토 완료 이벤트 덮어쓰기·잘못된 체크섬을 거부하며 같은 원본을 여러 번 적용해도 중복 생성하지 않는다. HTTP/OpenAPI·게임 계산·발생 확률은 변경하지 않는다. [검사/가져오기 절차](seeds/README.md)와 [실제 검토 결과 및 미검증 범위](reports/event-catalog-expansion.md)를 따른다.

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

신규 출전은 공유 `simulateRace`의 **race-sim-v4**를 기본 사용한다. 기존 v1/v2/v3 지정 요청과 저장 로그는 원래 계산으로 유지한다. v4는 기존 v3 코어에 잠긴 신뢰도의 execution 보정만 더한다. 적용 전 `npm run db:migrate`로 **007_jockey_trust.sql**까지 실행한다. readiness도 007을 요구하며 기존 migration과 저장 로그/결과는 변경하지 않는다.

[신뢰도 규칙·출전 전 전력 평가·DB/Local 이행·Frontend 계약](docs/jockey-trust.md)을 확인한다. 기존 내부 chemistry 필드는 신뢰도를 뜻하며 새 조회는 `GET /v1/careers/{careerId}/jockey-relations` / `getJockeyRelations`다. 현역/은퇴 관계의 trust·starts와 Career ID/revision을 소유자 범위로 제공한다. 실제 이벤트 1,000개에는 신뢰도 효과를 임의로 추가하지 않았다.

| 메서드와 경로                                                | 공유 클라이언트       | 반환 데이터                                                                                             |
| ------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /v1/careers/{careerId}/race-entries`                    | `getRaceEntryOptions` | 현재 Career, 기본 엔진, 현재 월 DB 경주별 `eligible`/`restrictionReason`, 계약 기수의 현재 신뢰도, 전술 |
| `POST /v1/careers/{careerId}/race-entries`                   | `enterRace`           | 잠긴 `raceRunId`와 Career                                                                               |
| `GET /v1/careers/{careerId}/race-runs/{raceRunId}`           | `getRaceRun`          | RaceRun, 출전 당시 건강, 엔진·digest·로그 크기 metadata                                                 |
| `GET /v1/careers/{careerId}/race-runs/{raceRunId}/log`       | `getRaceLog`          | 원본 Simulation Log와 최종 결과                                                                         |
| `POST /v1/careers/{careerId}/race-runs/{raceRunId}/complete` | `completeRace`        | 저장된 최종 결과와 경주 후 Career                                                                       |

출전 조회는 상태·Seed를 만들지 않는다. 전체 `restrictionReason`과 각 경주의 `eligible`을 확인하고, 조회된 계약 기수와 전술 중에서 선택한다. 출전 본문은 `{ raceRunId, raceDefinitionId, jockeyId, tactic, expectedTurn, engineVersion? }`이며 `expectedTurn`은 조회된 `career.state.careerTurnIndex`다. 서버는 확정 시 다시 검증한다. 확정 후 다른 Race/Jockey/Tactic/Engine Version이나 새로운 RaceRun ID로 같은 달 출전을 요청하면 409다. 클라이언트 Seed/Snapshot/결과 업로드는 400이다.

Run의 `engineVersion: 'entry-contract-v1'`은 **입력 계약 버전**이다. 실제 시뮬레이션 버전은 `raceRun.simulation.engineVersion`, metadata 및 Log의 `engineVersion`에 있다. 재생에 사용하는 `RaceRunInput`/`RaceSimulationLog` 구조는 유지한다. 생성 타입은 기존 OpenAPI의 길이 제약을 반영해 적성 쌍을 `[string, string]`으로 생성하므로 게임 타입에 직접 전달할 수 있다. `save-validation.mjs`의 `validateEnterRace`, `validateCompleteRace`, `validateRaceEntryOptions`, `validateRaceEntryResponse`, `validateRaceRunResponse`, `validateRaceLogResponse`, `validateRaceCompleteResponse`로 외부 JSON을 검사한다.

완료 본문은 `{ commandId }`다. 완료는 저장된 결과로 전적·상금·건강 변화·기승 횟수를 한 번 반영하고 **다음 월까지 진행**한다. 이후 `months/advance`를 추가 호출하지 않는다. 같은 완료 ID는 최초 receipt를 반환하고, 새 완료 ID로 이미 끝난 경주를 요청하면 저장 결과와 현재 Career를 반환한다. 예전 출전·완료 receipt의 Career는 당시 상태이므로 화면 복원에는 최신 `getCareerWorkspace`를 사용한다. 재시도는 ID와 본문을 그대로 유지하며, 과거에 엔진을 생략한 요청에는 새 엔진 필드를 추가하지 않는다.

서버 저장 controller/journal, Next bridge 및 Playback은 저장된 Log를 읽는 기존 흐름을 유지한다. 신규 신뢰도 조회도 bridge에서 검증하며 기존 명령 종류는 유지한다. 신뢰도 표시와 기수 화면 연결은 Frontend Work에서 새 계약을 사용해야 한다. 서버 유료 출전은 DB 등록비·마방 잔액을 검증하여 정산한다. 정식 경주/후보 출전 활성화 제한은 유지한다. [경제 정산 계약](docs/economy-settlement.md)을 따른다.

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

API와 Local Save의 신규 경주는 공유 **`race-sim-v4`**를 사용한다. v1/v2/v3 계산 및 로그를 보존하며 기존 v3 밸런스는 변경하지 않는다. v4의 유일한 엔진 보정은 신뢰도에 따른 bounded execution 증가다. 로그는 모든 버전에서 **원본 JSON 문자열과 JSONB**를 함께 저장하고 원본 필드 순서로 반환한다. 새로고침·재요청·완료와 DB 카탈로그 변경에서 저장 결과를 재시뮬레이션하지 않는다.

건강은 공유 `health.ts`의 정상·경상·중등도 부상 및 기존 별칭을 지원하고 중상·중증을 차단한다. 실제 건강과 `healthRecovery`를 Snapshot 및 응답에 보존한다. 최신 v0의 회복·경주 후 건강 규칙은 공유 `BALANCE.health`와 순수 함수를 사용하며 서버가 별도 부상 배율·악화 확률을 추가하지 않는다. v1.4 문서와 현재 playable의 세부 수치 차이는 별도 밸런스 조율이 필요하다. Local Save 유료 출전 제한, 후보 fixture, age 갱신 방식, 운영 후보 생성은 후속 공유 도메인 작업이다. 경주 상금은 저장된 Log 그대로 마방/말 기록에 한 번만 반영하며 승인된 신뢰도 변화와 기승 횟수도 같은 완료 트랜잭션에 저장한다.

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

## 전체 1,000개 카탈로그와 검토 후 활성화

사용자가 제공한 CSV/감사 원본은 `seeds/archives/events.expansion.csv-snapshot-2026-10-14.json`에 보관했다. 2026-10-15 Notion의 1,000개 고유 ID 속성 8개를 전수 대조하여 신규 20개의 개정 원문을 현행 `events.expansion.source.json`에 반영했다. 공통 350개 차이는 0개다. 원본에 없던 사건그룹은 만들지 않고 이전 감사 CSV 대응을 검토용으로 유지한다. Notion 본문·밸런스 승인을 완료했다는 뜻은 아니다. 기존 공통 350개 Seed·revision은 보존한다. 신규 650개는 `events.expansion.source.json`에 수록하고 엄격한 오프라인 변환기로 구조화한다. HTTP 경로는 조건/효과 문자열을 해석하지 않는다.

```bash
npm run events:expand
# 새 CSV로 교체할 때만: npm run events:expand -- /absolute/path/reviewed-current-export.csv
npm run db:migrate
npm run events:import-expansion
```

첫 명령은 원본을 정규화하고 `events.expansion.catalog.json`과 `reports/event-expansion.json`을 재생성한다. 인자를 생략하면 저장된 정규화 원본으로 재생성한다. `db:seed`도 기존 350개와 신규 650개를 함께 등록한다. 등록은 명시적으로 설정한 DB에 수행하며 서버 시작 시 자동 실행하지 않는다. 운영 데이터 가져오기는 이번 검증에서 실행하지 않았다.

신규 정의의 `review`에는 `converted`, `executable`, `contentReviewed`, `balanceReviewed`, 원본 해시와 `groupId`/`representativeId`가 있다. 변환 완료와 활성화는 별개다. 기본 신규 활성 수는 0개이며 기존 활성 수는 315개다. 현재 신규 276개가 변환/실행 가능하고 374개가 미지원 또는 검토 필요 상태다. GEN-0274/GEN-0284는 부상 상태의 훈련 결과가 현재 공유 규칙에서 도달 불가능하므로 비실행으로 분류한다. `status=ready`만으로 추첨하지 않는다. 활성화에는 아래처럼 검토한 **현재 revision**을 지정한 manifest가 필요하다.

```json
{
  "events": [
    {
      "id": "GEN-0001",
      "revision": "검토한 현재 revision의 SHA-256",
      "contentReviewed": true,
      "balanceReviewed": true,
      "groupReviewed": true,
      "representativeId": null
    }
  ]
}
```

```bash
npm run events:activate -- /absolute/path/reviewed-events.json
```

예시 ID는 실행 가능 여부를 보장하지 않는다. 미지원/미변환 항목과 오래된 revision은 거부한다. 검토 완료 항목은 동일 원본 재가져오기로 비활성 초안에 되돌리지 않는다. 원본이 변경되면 재검토가 필요하다. Advisory lock과 transaction으로 가져오기/활성화를 직렬화하며 005 migration은 DB의 단순 enabled 변경으로 검토를 우회하는 것도 거부한다. 새로운 대표 이벤트로 병합하려면 별도 대응 관계를 검토해야 한다. 이번 변경은 기존 ID를 삭제하거나 통합하지 않는다.

새 월은 `event-director-v2`가 기본이며 기존 발생률 0.3, 보정 기준 3회, 시작/결과 시점 정책은 유지한다. 발생 게이트 후 해당 실행 시점의 조건과 선택지를 만족하는 카테고리 사이에서 45:35:12:6:2를 재분배하고, 선택된 카테고리 내 이벤트 weight로 추첨한다. 기존 월의 v1 config/pool/seed와 선택/결과 Snapshot은 그대로 재사용한다. 미지원 경주 전/후 시점과 히든 복합 조건이 불완전한 정의는 활성화할 수 없다.

선택지의 선택적 `risk`는 `event-risk-v1`과 네 결과(`great_success`, `success`, `failure`, `disaster`)별 구조화 효과를 요구한다. 명시적 플레이어 선택만 15:55:25:5로 판정하고, draw seed/불변 revision/choice ID로 결과를 고정한다. 안전 선택은 원래 effects를 그대로 적용한다. 개정된 Notion 원문에는 위험 결과 제안이 있으나 승인된 네 결과 구조화 효과는 없으므로 이를 임의 해석하거나 실제 위험 선택으로 변환하지 않았다. 네 결과의 효과도 일반 효과와 동일한 시점·성장 문맥 검사를 거치며 결과 시점 action_modifier는 등록 단계에서 거부한다. 확정 결과는 `career.event.result.risk`에 저장된다.

Frontend 계약은 기존 `GET /v1/events`, 상세 조회, `GET /v1/careers/{id}`, 이벤트 이력 및 `POST /v1/careers/{id}/events/{historyId}/choice`를 유지한다. 새로운 조건 타입 5개와 optional review/risk/result.risk는 생성 타입·검증기에 포함한다. choice 요청은 기존 `{commandId, choiceId, expectedTurn}`이며 결과/Seed는 받지 않는다. 이벤트는 월간 핵심 행동을 추가 소모하지 않는다. 재시도는 같은 UUID/본문을 유지하고 과거 receipt 대신 최신 workspace를 조회한다. Frontend는 활성 여부와 검토 상태를 구분하고 위험 선택의 네 결과 표시를 별도로 구현해야 한다.

미지원 원문과 ID, 111개 사건그룹, 96개 동일 조건·효과·시점 묶음은 `reports/event-expansion.json`에 있다. 그룹은 의미상 중복 확정이 아닌 검토 후보이며 원본 서술 없는 CSV로 서사/밸런스 QA 완료를 주장하지 않는다. 다음 훈련/휴식 이월, 호흡도·육성/회복 이력·연령·Archive·다음 경주 후보 관련 조건과 모호한 성장 대상은 임의 대체하지 않는다. 기존 P1 보고서는 사전 검증 당시의 기록이며 최신 확장 수치는 새 보고서를 따른다.

## 공개 이벤트 접근 정책과 원본 개정

공개 목록·직접 ID 조회는 활성·ready·검토 완료 비히든 정의로 한정한다. 초기 공통 활성315개를 유지하며 비활성35개와 미검토 신규650개, 승인 여부와 관계없는 히든 정의는 전체 카탈로그에서 숨긴다. query는 이 경계를 넓히지 못하고 total/페이지도 공개 범위만 집계한다. 숨긴 ID와 없는 ID는 동일 404다. 실제 발생한 히든은 소유자 인증 Career/이력 응답으로만 확인한다. 내부 SQL 풀에는 승인된 히든이 계속 포함된다.

응답의 source.url은 null, source.conditionText/effectText는 빈 문자열, body는 생략한다. 내부 DB 원문과 불변 revision은 유지한다. Frontend는 구조화 conditions/choices/effects와 고정 description을 사용하고 공개 API로 비활성 전체 목록을 구현하지 않는다. 관리용 조회 API는 이번 범위에 추가하지 않았다. HTTP 경로와 응답 필드는 유지하지만 공개 대상과 원문 노출 범위를 축소한 계약 변경이다.

사건그룹 ID도 sourceDigest에 포함한다. 미검토 원본의 그룹 변경은 새 revision이며 이전 승인 manifest는 실패한다. 이미 승인한 정의는 원본/그룹이 같을 때만 재가져오기를 허용한다. 변경되면 전체 import를 롤백하고 재검토를 요구한다. 승인된 이전 revision과 기존 Career의 draw/history는 덮어쓰지 않는다. `reports/event-expansion.json`의 sourceComparison은 보관 CSV와 현재 속성의20개 차이 및 양쪽 원문을 기록한다. P1의 events.drafts.import.json은 과거 검사 snapshot이므로 현재 등록 입력으로 사용하지 않는다.

## 실존 경마장·경주 일정 참조 카탈로그

`006_racing_reference_catalog.sql`은 `racecourses`, `racecourse_courses`, `race_schedules`를 추가한다. 기존 `race_definitions` 17개, Career/RaceRun/결과/ledger/저장 로그와 분리되어 있으며 `db:seed`와 서버 시작은 실존 카탈로그를 가져오지 않는다. `/health/ready`는 현재 최신 007까지 적용되어야 성공한다. 운영 DB에는 이번 작업에서 적용하지 않았다.

2026-10-15 Notion의 필터 없는 기본 뷰를 끝까지 조회한 속성 snapshot을 `seeds/racing.notion.source.json`에 보존했다. 경마장 **90**, 코스 **101**, 경주 원본 **851행**이다. 비공개 Notion 페이지 식별자는 제거하고 관계는 원본의 안정 ID로 바꿨다. 공식 외부 출처·메모·원본 제원은 보존한다. 변환 결과는 `seeds/racing.catalog.json`, 검토 목록은 `reports/racing-catalog.json`이다. 이 수치는 서로 다른 851개 대회 또는 실행 가능한 경주 수가 아니다.

| 구분     | 원본 경주 행 |
| -------- | -----------: |
| 한국 KRA |           51 |
| 일본 JRA |          130 |
| 일본 NAR |           46 |
| 미국     |          624 |

현재 Notion의 미국 624행은 TOBA ID 622개와 별도 브리더스컵 ID 2개(`RACE_USA_2026_BC_TURF`, `RACE_USA_2026_BC_CLASSIC`)다. 요청의 “TOBA 624”와 출처 구성이 다르지만 원본 851행을 그대로 보존했다. 미국의 동일명·경마장·등급 중복 후보는 Eddie Logan, Robert J. Frankel, Fifth Season의 3쌍이며 삭제·병합하지 않는다. `duplicateGroup`으로 묶고 검토 항목을 붙인다. 날짜 없는 **41행**은 `date_unconfirmed` **23행**, `not_run` **18행**이다. 날짜를 생성하지 않는다. 기본 목록의 total은 참고 원본 행 수이며, 실제 달력에는 `scheduleStatus=dated` 또는 year/month 필터를 사용해야 한다.

### 오프라인 변환과 수동 Import

```bash
npm run racing:prepare
npm run db:migrate
npm run racing:import
# 새로운 Notion 속성 JSON packet 또는 CSV 3종을 검증·변환해 snapshot 교체
npm run racing:prepare -- /absolute/path/notion-packet.json
npm run racing:prepare -- /absolute/path/racecourses.csv /absolute/path/courses.csv /absolute/path/races.csv
# 검토한 입력을 명시적 DB로 가져오기
npm run racing:import -- /absolute/path/notion-packet.json
```

JSON 형식은 `{ sourceVersion: 1, capturedAt: 'YYYY-MM-DD', racecourses: [...], courses: [...], races: [...] }`이며 각 행은 보관 snapshot과 동일한 Notion 속성명/타입이다. JSON의 `실제 개최일`은 `date:실제 개최일:start` 키다. CSV는 Notion의 표시 속성명을 사용하고 숫자는 단위 없는 숫자 또는 천 단위 쉼표 표기, 날짜는 ISO `YYYY-MM-DD`를 사용한다. 지역별 모호한 날짜나 단위가 섞인 숫자는 검증 전에 명시적으로 정리해야 한다. 빈 값은 null로 유지한다. CSV 관계는 정확한 경마장 ID/고유 제목, JSON 관계는 그 값 하나의 배열 문자열을 사용한다. Notion의 `제목 (페이지 URL)` 표기도 정확한 제목 또는 packet의 URL과 일치해야 한다. 여러 관계·존재하지 않는 관계·국가 충돌·중복 ID는 실패한다. 코스는 자동 배정하지 않는다.

Import는 전체 입력 검증 후 advisory lock과 단일 트랜잭션으로 실행하며 안정 ID로 upsert한다. 같은 입력의 재실행은 변경 없음 1,042건(90+101+851), 생성·갱신 0건이다. 삭제는 수행하지 않는다. `created`, `updated`, `unchanged`, `needsReview`, `failed`, `committed`와 엔티티/국가별 건수를 JSON으로 출력한다. needsReview는 생성/갱신/변경 없음과 겹치는 검토 대상 수다. 잘못된 입력이나 DB 쓰기 실패는 전체 rollback, 성공 쓰기 0건, failed=1(실패한 배치), 종료 코드 1이다. 부분 packet에서 빠진 기존 행은 삭제되지 않으므로 **카탈로그 교체에는 전체 Export를 사용**한다. 정기 수집이나 외부 웹 요청은 없다.

`gameEnabled`는 원본 체크박스와 관계없이 모두 false다. 세 테이블 모두 SQL CHECK로 true/누락/null을 거부하며 일정의 `entryEligibility`는 항상 `not_evaluated`다. 활성화 API/명령은 없다. 이후 콘텐츠·코스/엔진·경제 승인과 별도 migration/기능이 필요하다. 2026년 공식 날짜를 게임의 2028년 달력에 이식하지 않는다.

### Frontend 조회 계약

| API                          | 응답                                 | 공유 클라이언트    |
| ---------------------------- | ------------------------------------ | ------------------ |
| `GET /v1/racecourses`        | `{data: Racecourse[], pagination}`   | `listRacecourses`  |
| `GET /v1/racecourses/{id}`   | `{racecourse, courses: Course[]}`    | `getRacecourse`    |
| `GET /v1/race-schedule`      | `{data: RaceSchedule[], pagination}` | `listRaceSchedule` |
| `GET /v1/race-schedule/{id}` | `RaceSchedule`                       | `getRaceSchedule`  |

공개 읽기이며 인증 토큰이 필요 없다. 코스가 없는 시설도 `courses: []`로 조회한다. 목록 공통 query는 `page`(기본 1), `pageSize`(기본 20, 최대 100), `country`(`KOR/JPN/USA`), `verificationStatus`, `search`다. 일정에는 `year`, `month`, `racecourseId`, `grade`, `surface`, `minDistance`, `maxDistance`, `scheduleStatus`를 추가한다. 등급은 원본의 상위 분류(`G1/G2/G3/Listed/기타`)이며 `originalGrade`, `gradeSystem`, `internationalGrade`도 함께 표시해야 한다. USA L/LR, KRA 국내/국제, NAR 미확인을 합쳐 표시하지 않는다.

일정 정렬은 `raceDate ASC NULLS LAST, id ASC`이며 경마장 정렬은 ID 오름차순이다. 각 목록 요청의 데이터와 total은 동일한 읽기 snapshot에서 조회한다. 페이지 간 순서는 데이터가 동일할 때 안정적이며 Import 도중 여러 요청에 걸친 고정 snapshot/cursor는 제공하지 않는다. 잘못된 query/거리 범위는 400, 없는 ID는 404다. `search`의 `%`/`_`는 와일드카드가 아닌 문자다. 출전 가능 여부는 이 API에서 평가하지 않는다. 게임용 후보는 기존 소유자 Career `/race-entries`, 17개 개발용 정의는 기존 `/v1/catalog/races`를 사용한다.

```ts
const result = await client.listRaceSchedule({
  country: 'KOR',
  year: 2026,
  month: 9,
  grade: 'G1',
  surface: 'sand',
  racecourseId: 'RC_KOR_SEOUL',
  minDistance: 1200,
  maxDistance: 1800,
})
// pagination.total = 2; 코리아컵/코리아 스프린트. 양쪽 모두 gameEnabled=false.
const facility = await client.getRacecourse('RC_KOR_SEOUL')
```

생성 타입은 `components.schemas.Racecourse/Course/RaceSchedule`과 목록/상세를 사용한다. `generated/save-validation.mjs`의 `validateRacecourse`, `validateCourse`, `validateRaceSchedule`, `validateRacecourseList`, `validateRacecourseDetail`, `validateRaceScheduleList`로 외부 응답을 검사할 수 있다. 기존 API 응답은 변경하지 않았다. Frontend 화면 수정은 포함하지 않는다.

미확인 제원·자격·상금·최대 출전두수·코스 연결은 null이다. 연령/성별 원문은 `originalEligibility`에도 보존하며 성별 제한이 없는 것을 추정하지 않는다. 미국 `distanceMeters`는 Notion 명목 환산값을 그대로 보존하고 `originalDistance`/unit 및 `distanceBasis=nominal_conversion`으로 구분한다. 실제 발주선 검증을 뜻하지 않는다. 두 중복 후보의 원문 거리/등급은 현재 메모에서 빠져 있으므로 null/검토 표시하며 다른 행에서 복사하지 않는다. NAR는 기타/미확인 상태를 유지하고 환율·게임 상금을 생성하지 않는다.
