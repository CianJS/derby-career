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

`http://127.0.0.1:4000/health/ready`와 `GET /v1/events?category=common&enabled=true`로 확인한다. `db:seed`는 기존 playable 코드의 말 3두·기수 6명·경주 8개와 실제 Notion 이벤트를 넣는다. 말/기수/경주는 `development_fixture`로 명시하며 운영 환경에서 `db:seed`는 거부한다. 이벤트만 가져오려면 `npm run events:import -- seeds/events.catalog.json`을 사용한다.

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

**운영 인증 정책은 미정이다.** 운영 로그인 공급자와 principal 매핑, 세션 관리, 공유 인프라의 요청 제한 정책을 확정한 후 별도 구현·검토해야 한다. 개발 세션을 운영 인증으로 활성화하는 우회 옵션은 없다.

## 계약과 연동

`contracts/openapi.yaml`이 HTTP 계약의 기준이다. 서버는 이 파일로 요청을 검증하고 응답을 직렬화하며, 공유 타입도 여기서 생성한다.

```bash
npm run contract:generate
npm run contract:check
```

계약을 변경할 때 YAML과 `packages/shared/src/generated/api.ts`를 함께 커밋한다. 기존 프론트엔드 페이지·store·Local Save는 연결하거나 이전하지 않았다. 루트 `tsconfig.json`의 서비스/패키지 제외는 API의 독립 타입 검사를 위한 설정이다. 기존 pnpm lockfile과 Next 실행 스크립트는 그대로다.

프론트엔드에서 안전하게 시작할 연동은 공개 카탈로그 Adapter다.

```ts
import { createEventCatalogAdapter } from '@/packages/shared/src/event-catalog-adapter'

const events = createEventCatalogAdapter('http://127.0.0.1:4000')
const page = await events.list({ category: 'common', enabled: true, page: 1, pageSize: 20 })
const detail = await events.detail('COM-0001')
```

`createApiClient`에는 권한이 있는 Career 메서드도 있다. 서버 Career를 선택한 화면은 반환된 `career.state`만 표시·사용해야 한다. Local Save와 서버 상태를 병행 계산·동시 authoritative 저장으로 사용하지 않는다. Adapter는 local storage, cookie, 기존 브라우저 저장을 읽거나 수정하지 않는다. 운영 인증이 완성되기 전에는 기존 브라우저 Career의 쓰기 경로를 전환하지 않는다.

주요 요청 ID 규칙:

| 작업                | 유지해야 할 UUID                 | 동작                                         |
| ------------------- | -------------------------------- | -------------------------------------------- |
| Career 생성         | `careerId`                       | 동일 본문 재시도는 기존 응답 재생            |
| 월간 행동           | `actionId`                       | 같은 월 다른 ID/행동은 409                   |
| 이벤트 선택·다음 월 | `commandId`                      | 같은 ID 다른 본문은 409                      |
| 출전 확정           | `raceRunId`                      | Seed·입력·로그 잠금                          |
| 경주 완료           | `commandId` + 저장된 `raceRunId` | 다른 commandId로 재호출해도 상금·월 진행 1회 |

API `actionId`는 UUID이며 `career.state.action.actionId`의 기존 도메인 문자열과 다르다. 다음 월 요청에는 행동 API가 반환한 UUID를 사용한다. 생성형 AI 호출, 클라이언트 state/result/seed 업로드, 결과 재추첨 API는 없다. 재시도에는 최초 요청 ID와 본문을 그대로 유지하고 현재 상태는 GET으로 다시 조회한다.

## DB와 도메인

버전별 SQL 파일을 하나의 migration runner로 실행한다. 트랜잭션·advisory lock·적용 체크섬을 사용한다. 적용된 migration은 수정하지 않고 새 파일을 추가한다. destructive down migration은 제공하지 않는다.

Career의 `state`는 기존 순수 도메인이 사용하는 authoritative aggregate이며 능력·건강도 여기에 있다. 별도 복제 계산용 stats 테이블은 만들지 않았다. 소유 말은 고유 UUID와 정의 FK를 가지며 Career·월간 행동·경주 결과·기수 관계는 이 UUID를 참조한다. 마방 자금·계약·세계 시간은 stable에 있다. 은퇴 기록을 위한 immutable snapshot 테이블도 준비했지만 은퇴 API는 이번 범위에 포함하지 않았다.

월간 명령은 principal → Career 순으로 잠그고 월당 행동 UNIQUE, 소유권 FK, 입력 해시, 불변 응답 receipt를 함께 저장한다. 성장·이벤트·기록·상금은 같은 트랜잭션으로 반영한다. RaceRun·시뮬레이션 로그·결과·상금 ledger·은퇴 snapshot은 SQL trigger로 수정/삭제를 막는다. 이벤트 선택과 완료된 행동도 변경할 수 없다.

`packages/shared/src/domain.ts`는 `lib/career`의 기존 순수 함수만 재내보낸다. `server-domain.ts`는 이 함수들을 사용하면서 브라우저 fixture 이벤트를 등록하지 않는다. 서버 이벤트는 별도 envelope/DB로만 관리하고, 성장·치료·회복·기본 이벤트 성장/비용 계산은 최신 공유 함수로 처리한다. 서버용 계산 사본이나 새로운 v3 엔진을 작성하지 않았다.

기준 브랜치 최신 `8430c1a`에는 v0가 추가한 v3 기본 엔진·건강 회복·Local 이벤트가 있다. 이번 API의 기본 엔진은 요청 범위에 맞춰 **`race-sim-v2`로 명시 고정**하며 v1도 지원한다. 기존 frontend 기본 v3를 변경하지 않고, API에서 v3 요청은 거부한다. 이 차이는 전체 서버 전환 전에 조율해야 한다. 로그는 v1/v2 해시 호환성을 위해 **원본 JSON 문자열과 JSONB**를 함께 저장하고 원본 필드 순서로 반환한다. 저장 결과는 재시뮬레이션하지 않는다.

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
