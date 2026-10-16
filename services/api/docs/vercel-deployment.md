# Vercel 공개 카탈로그 API 배포

## 현재 확인한 환경과 적용 범위

2026-10-17 작업 시작 기준 develop은 `b874f602c55b6e64e05dd93a00cb527b826d6ad8`이다.

| 기존 프로젝트  | 확인한 상태                                                                                       | 이번 작업의 처리         |
| -------------- | ------------------------------------------------------------------------------------------------- | ------------------------ |
| `derby-career` | Next.js preset, Node 24.x, 같은 저장소 develop Preview READY. PostgreSQL/Neon 환경변수 이름 존재. | 설정/DB/도메인 변경 없음 |
| `derbycareer`  | framework override null, Node 24.x, 같은 저장소 develop Preview READY. 조회된 환경변수 없음.      | 설정/DB/도메인 변경 없음 |

두 프로젝트 모두 현재 루트의 Frontend 구성을 배포하는 것으로 보인다. 둘 중 하나가 API 전용이라는 근거는 없다. 일반 프로젝트/배포 요약 및 **암호화 해제 없는 환경변수 이름**은 조회했지만, 명시적 팀 범위 상세 조회는 403이다. CLI에는 인증이 없다. 두 프로젝트 모두 Vercel SSO 보호가 설정되어 있다. 연결 문자열/토큰/패스워드를 조회하거나 기록하지 않았다. `DERBY_API_URL`도 조회된 이름에 없다. Next가 배포되거나 DB 환경변수가 존재하는 것만으로 Fastify가 실행되지는 않는다.

기존 프로젝트를 API로 전환하지 않았다. 총괄이 **기존 프로젝트 역할 변경 또는 별도 API 프로젝트 생성**을 승인한 뒤 아래 설정을 적용한다. 새 DB/프로젝트 생성, 유료 기능, 운영 DB migration/import와 Production 승격은 이 PR에서 실행하지 않는다. API가 실제 공개돼야 Next의 서버 요청이 SSO 로그인 HTML 대신 JSON을 받을 수 있다. 보호 해제/우회 secret 설정도 총괄의 배포 정책에 따라 별도로 결정한다.

## API 프로젝트 설정

| 설정                                        | 값                                           |
| ------------------------------------------- | -------------------------------------------- |
| Git 저장소 / Preview 브랜치                 | `CianJS/derby-career` / 검토한 PR head       |
| Root Directory                              | `services/api`                               |
| Framework Preset                            | Other (`null`)                               |
| Node.js                                     | 24.x (코드 빌드 타깃 node22)                 |
| Include source files outside Root Directory | 켜기: 공유 lib/packages/contracts 필요       |
| Install / Build                             | `npm ci` / `npm run build:vercel`            |
| Output Directory                            | 별도 override 없음, Build Output API v3 사용 |
| Function                                    | `functions/api.func`, 최대 30초              |

설정 파일은 **`services/api/vercel.json`**이다. 루트 `vercel.json` 및 Frontend install/build는 그대로 둔다. `tsup`은 API의 npm lock으로만 설치한 뒤 공유 TypeScript 계산을 번들링하고, `@vercel/nft`가 외부 npm runtime 의존성을 추적해 `.vercel/output/functions/api.func`에 복사한다. Next/루트 node_modules는 필요 없다. OpenAPI 원본도 Function의 `dist/openapi.yaml`에 함께 복사한다. 런타임은 `import.meta.url` 기준으로 계약을 읽으며 저장소의 cwd에 의존하지 않는다.

Build Output API v3의 `.vc-config.json`에 `shouldAddHelpers=false`를 명시한다. Node runtime helper가 요청 body를 먼저 소비하지 않도록 하며 Fastify가 JSON, 16 KiB 제한, 검증 오류를 처리한다. Next Pages Router의 `config.api.bodyParser` 설정이나 별도 환경변수에 의존하지 않는다. output `config.json`이 경로 전체를 `/api` Function으로 연결하며 기존 `/health/*`, `/v1/*` 계약을 그대로 사용한다.

Fastify와 pg Pool은 프로세스별 한 번 초기화하고 cold start 동시 요청이 같은 promise를 공유한다. Function은 `listen()`하거나 응답마다 `close()`하지 않으며 응답 finish/close까지 기다린다. Fluid Compute idle connection 정리는 `attachDatabasePool`을 사용한다. 프로세스 간 메모리 공유/요청 제한 통합은 제공하지 않는다.

## 환경변수

| 이름                    | 대상 / 설정                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | **API Preview 런타임**의 pooled PostgreSQL URL. 해당 환경 전용 DB/역할 사용, 공급자의 TLS 검증 옵션 유지. |
| `AUTH_MODE`             | `disabled`. 기본값도 disabled이며 다른 모드는 Function 초기화 거부.                                       |
| `DB_POOL_MAX`           | 선택, 기본 3, 정수 1~10. 총 인스턴스 수를 고려해 공급자 connection limit에 맞춤.                          |
| `LOG_LEVEL`             | 선택, 기본 info. Preview 확인에는 warn 권장.                                                              |
| `CORS_ORIGINS`          | 브라우저 직접 호출 시 정확한 HTTPS 출처를 쉼표로 구분. Next 서버 경유 호출은 CORS 불필요.                 |
| `DATABASE_URL_UNPOOLED` | **승인된 별도 DB 작업 환경에만** 필요한 direct 관리자 연결. Function에는 불필요.                          |
| `DERBY_API_URL`         | **Frontend Next 서버**에 API HTTPS origin 설정. `NEXT_PUBLIC_` 사용 안 함.                                |

NODE_ENV는 Vercel에서 production이며 Function도 production으로 강제한다. Preview에서도 dev-session/oidc-jwt로 개인 저장 API를 켤 수 없다. 개발 세션 토큰, OIDC 키/설정, 개발용 Seed는 이 배포에 필요 없다. Vercel 연동에서 넣은 다른 `POSTGRES_*` 이름을 자동 fallback으로 사용하지 않는다. 런타임용 pooled URL과 migration용 direct URL을 분리하고 Preview가 Production DB를 공유하지 않는지 관리자가 확인해야 한다.

## 승인된 DB 준비 절차

아래 명령은 **승인된 대상 DB**에서만 실행한다. 이 작업에서는 로컬/CI의 일회용 테스트 DB만 사용한다. 비밀값은 관리자의 secret 환경으로 주입하며 셸 인수, PR, 로그, .env 커밋에 넣지 않는다.

```bash
cd services/api
npm ci
# DATABASE_URL_UNPOOLED를 승인된 작업 환경에 주입한 후 실행
AUTH_MODE=disabled npm run deployment:db -- migrate
AUTH_MODE=disabled npm run deployment:db -- import-racing
# 동일 원본 재실행: created=0, updated=0, unchanged=1042
AUTH_MODE=disabled npm run deployment:db -- import-racing
```

이 전용 명령은 `migrate`와 저장소 snapshot의 `import-racing`만 허용한다. `db:seed`, 세션 발급, 이벤트 import/활성화는 호출하지 않는다. `NODE_ENV=production`을 강제하며 연결/입력 오류를 고정 오류로 출력해 URL이나 드라이버 원문이 로그에 나오지 않게 한다. 기존 migration runner의 트랜잭션·체크섬·advisory lock 및 참조 import의 트랜잭션·안정 ID upsert를 재사용한다. import는 각 테이블 90/101/851건, 총 1,042건이다. 신규 SQL migration은 없으며 **001~007 원본은 변경하지 않는다**.

서버 시작, build, health 요청은 migration/import를 실행하지 않는다. 준비 실패 시 Preview를 승격하지 말고 원인을 확인한 뒤 동일 명령을 재시도한다. DDL은 명시적 배포 단계에서만 수행하므로 DB URL이 없는 Vercel build도 가능하다. 데이터가 없으면 readiness가 성공해도 목록은 0건일 수 있으므로 반드시 아래 카탈로그 검증까지 실행한다.

## 배포 후 읽기 검증 및 FE 연결

```bash
# API_BASE_URL에 배포한 HTTPS origin을 환경변수로 설정
npm run smoke:catalog
```

이 명령은 공개 GET만 실행하며 생성 검증기로 응답 구조도 확인한다. 기대 결과:

```json
{
  "races": 851,
  "countries": { "KOR": 51, "JPN": 176, "USA": 624 },
  "racecourses": 90,
  "privateApi": "disabled"
}
```

검사 범위: `/health/ready` 200, `/v1/race-schedule?page=1&pageSize=100`부터 9페이지 851개 고유 ID, 국가/연도별 수량, `/v1/racecourses?pageSize=100` 90곳, 날짜 null 41행, gameEnabled=false, private Career 503, 잘못된 page 400. 경마장 API 기본 pageSize는 20이므로 기본 응답의 `pagination.total=90`과 한 페이지 길이를 혼동하지 않는다. HTML/SSO 로그인 페이지, 잘못된 JSON/계약/수량, timeout/redirect는 검증 실패다. 무단 bypass 토큰을 발급하거나 보호 설정을 변경하지 않는다.

FE는 `DERBY_API_URL` 설정 후 기존 Next `/api/racing-catalog/*` bridge를 사용한다. 요청/응답 OpenAPI, 생성 타입 및 클라이언트는 변경하지 않았다. 경주 851행은 모두 정보 카탈로그이며 실제 출전은 비활성이다. 기존 Career/RaceRun/신뢰도/상금/17개 개발 경주 계산에 변경이 없다.

환경변수 누락/잘못된 설정은 고정 JSON 503 `API_NOT_CONFIGURED`, 연결 실패나 migration 누락 readiness는 503 `DATABASE_UNAVAILABLE`이다. DB 조회 실패의 카탈로그 응답은 기존 계약의 500 `INTERNAL_ERROR`를 유지하며 fixture 응답으로 대체하지 않는다. Function 초기화·유휴 연결·요청 실패 로그에는 raw error/연결 정보를 출력하지 않는다.

## 검증과 한계

- `tests/vercel.test.ts`: 공개 전용 설정, 오류 복구/비노출, 동시 cold start, 실제 Node HTTP 요청, 851/90 import 재실행, fixture/개인 데이터 미생성, DB 실패, 잘못된 응답, pool lifecycle hook.
- `verify-vercel` CI: **별도 빈 PostgreSQL 17 DB**에 운영용 준비 명령만 실행, import 2회, bundle 빌드, 저장소 바깥 임시 폴더에서 runtime+OpenAPI로 HTTP 검증. Native 동시성 기존 테스트는 기존 job에서 계속 실행한다.
- 기존 format/lint/typecheck/contract/API·Frontend·Browser CI를 유지한다. 이전 엔진/저장 로그 golden과 공통 이벤트 snapshot은 수정하지 않는다.
- 실제 Vercel API Preview는 API 대상 프로젝트 승인/상세 설정 권한과 환경 전용 DB 변경 승인 전에는 생성하지 않았다. 로컬/CI Node HTTP 검증은 Vercel CDN rewrite/SSO/실제 provider pool의 검증을 대체하지 않는다.

공식 참고: [Fastify](https://vercel.com/docs/frameworks/backend/fastify), [Node runtime](https://vercel.com/docs/functions/runtimes/node-js), [attachDatabasePool](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package), [Monorepo](https://vercel.com/docs/monorepos).
