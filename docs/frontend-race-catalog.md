# 경주 정보·상세 공개 API 연동

관련 이슈: https://github.com/CianJS/derby-career/issues/22

## 경계

- 기존 `Management`/`Section` 디자인을 유지하고 경주 정보 목록/상세만 변경한다.
- `lib/race-catalog`은 공유 OpenAPI 타입·생성 검증기·`createApiClient`를 사용한다. Backend/공유 엔진/계약/generated는 수정하지 않는다.
- 경주 원본 851행을 100행씩 조회한다. 브라우저 번들에 서버 snapshot을 포함하지 않는다. 테스트에서만 기존 변환 결과를 계약 fixture로 읽는다.
- 경마장 옵션은 서버 목록(pageSize=100)에서 읽는다. 현재 카탈로그 전체 90개가 한 페이지에 들어온다. 향후 경마장이 100개를 넘으면 이 선택 목록도 별도 페이지 조회를 확장해야 한다.
- 미확인 조건·상금·코스는 미확인으로 표시한다. 등록료/부담중량/날씨/능력 요구치를 만들지 않는다. 금액은 KRW/JPY/USD와 서버 `prizeBasis`를 그대로 표시한다.
- `duplicateGroup` 3쌍은 삭제/합산하지 않고 중복 검토 후보로 표시한다. `not_run`과 `date_unconfirmed`를 구분하고 임의 날짜를 생성하지 않는다.
- URL의 `rc_` 필터·페이지와 `raceId`로 목록/상세를 복원한다. 목록을 떠날 때 history.state에 스크롤/선택 행을 보존하며 재진입 후 해당 행에 포커스를 복구한다. 게임 저장 문서는 수정하지 않는다.
- 요청 키와 AbortController/active guard로 필터 변경·상세 변경·화면 이탈 뒤 과거 응답을 차단한다. 오류 후 다시 시도는 같은 조회 조건이다.

## 실행 및 실제 HTTP 검증

API 설정과 import 절차는 `services/api/README.md`를 따른다. Next의 `DERBY_API_URL`은 서버 전용이며 인증 token을 공개 조회에 쓰지 않는다. 프록시의 503(설정 없음), 502(연결/응답 문제), 504(timeout), 404와 429를 구분한다. 성공/실패 모두 no-store다.

```bash
pnpm exec next typegen
pnpm exec tsc --noEmit --incremental false
pnpm build
pnpm exec tsc --project tsconfig.frontend-integration.json --noEmit --incremental false
node --import ./services/api/node_modules/tsx/dist/loader.mjs --test tests/*.test.ts
cd services/api
node --import ./node_modules/tsx/dist/loader.mjs --test ../../tests/*.integration.ts
```

`tests/race-catalog.integration.ts`는 실제 migration/기존 Notion snapshot import를 적용한 PGlite PostgreSQL 엔진과 Fastify HTTP 서버를 띄운다. 별도 프로세스의 Next 운영 빌드를 기동하고 공개 프록시를 HTTP로 요청한다. 임의 성공 응답을 만드는 서버 mock을 사용하지 않는다. 이 테스트는 `pnpm build` 이후 API 디렉터리에서 실행한다.

확인한 네트워크 경로(Next `/api/racing-catalog` → 아래 Fastify GET)는 모두 200이다:

- `/v1/race-schedule?pageSize=100`: import 전 total=0, import 후 total=851.
- `/v1/race-schedule?page=1..9&pageSize=100`: 100행 8페이지 + 51행, ID 중복 없이 851행.
- 국가 필터 KOR/JPN/USA: 각각 51/176/624행. 각 목록의 선택 ID를 상세 API로 조회하고 해당 경마장 상세도 조회한다.
- 예시 선택: `RACE_KOR_2026_KRA_001`, `RACE_JPN_2026_JRA_001`, `RACE_USA_2026_TOBA_93DA31D717C814`.
- `/v1/race-schedule?country=KOR&year=2026&month=9&grade=G1&surface=sand&racecourseId=RC_KOR_SEOUL&minDistance=1200&maxDistance=1800&pageSize=100`: total=2.
- `/v1/racecourses?pageSize=100`: 90개. 없는 경주명 검색 total=0.
- 인증/cookie가 있는 브라우저 요청도 upstream에서는 두 헤더가 제거됨을 확인한다.
- 신규 참고 자료를 읽은 뒤 기존 playable race_definitions 건수는 변하지 않는다.

일반 테스트는 날짜 없는 41행(미확정 23/미개최 18), 중복 3쌍, 통화·등급, 851행 계약 fixture 페이지 분할, 잘못된 응답/과대 페이지, URL 복구, 국가 변경 시 경마장 해제/첫 페이지 이동, 응답 역전/재시도, 표/필터/오류 상태의 접근성 markup을 검사한다. 기존 Local Save·v1 digest·v1/v2/v3 관전과 서버 Month 3/6 경주 테스트도 유지한다.

## 검증 한계와 Backend 확인 사항

- 실제 브라우저 클릭·장시간 스크롤·모바일/PC 스크린샷은 수행하지 않았다. 렌더링 markup과 네트워크/DB 검증을 브라우저 검증으로 주장하지 않는다. 현재 환경에 Sites가 요구하는 control-browser 스킬이 없어 스크린샷을 첨부하지 않았다.
- PGlite는 실제 PostgreSQL 엔진을 쓰는 격리 테스트 DB다. 별도 운영 PostgreSQL 인스턴스나 Backend Work의 개발 DB를 확인한 것은 아니다.
- 배포된 실제 API URL은 전달받지 않았다. 개발용 `127.0.0.1`을 원격 API 주소로 취급하지 않는다. Backend Issue #21에서 import한 DB/API 주소를 확인하면 Next 서버의 `DERBY_API_URL`을 설정해야 한다. 이 프록시 방식에서는 브라우저가 Fastify를 직접 호출하지 않아 CORS 변경은 필요하지 않다.
- 기존 비공개 정적 Sites에는 Next 프록시/Fastify/PostgreSQL을 배포하지 않는다. 미리보기의 경주 정보는 API 연결 오류를 정직하게 표시하며 로컬 fixture로 우회하지 않는다. 실데이터 원격 미리보기에는 API를 제공하는 Next 호스팅 환경이 필요하다.

## PR #23 라우팅 리뷰 수정

초기 App effect가 공개 상세 `race`를 복구한 뒤 로컬 개발 화면 허용 목록으로 재판정하면서 홈으로 덮어쓰는 결함을 수정했다. 초기 복구는 한 번만 화면을 결정하고 `updateView`만 호출한다. URL을 정리하는 탐색 `setView`는 사용자의 화면 이동에만 사용한다. 서버 관전 자동 복원은 화면 hydration 이후 실행해 이미 로드된 서버 workspace가 공개 상세를 가로채지 않도록 한다.

`tests/app-routing.test.ts`는 jsdom + React DOM으로 실제 App의 SSR 마크업을 hydrateRoot로 hydration하며 하위 화면/useEffect/상태 저장 구독/History API까지 실행한다. 공개 API 응답은 기존 계약 fixture, 저장 API 응답은 실패 또는 검증된 활성 Career fixture로 격리한다. 실제 HTTP·DB 연동 테스트와 구분한다. jsdom은 테스트 전용 의존성이며 실제 브라우저 엔진/스크린샷 검증이 아니다.

- 수정 전 같은 테스트에서 로컬 상세 직접 URL이 실제 홈으로 이동해 실패하는 것을 확인했다.
- 두 저장 모드에서 `?view=race&raceId=RACE_KOR_2026_KOREA_CUP&rc_page=9` 직접 진입·재마운트 후 상세와 전체 query를 보존한다.
- 두 저장 모드에서 9페이지 목록 → 선택 ID 상세 → 실제 History Back/Forward → 명시적 홈 이동을 검증한다. 홈 이동 때에만 공개 view/ID를 제거하고 목록 조건은 보존한다.
- 서버 active RaceRun의 최초/재마운트 관전 복원과, 이미 로드된 서버 workspace가 공개 상세를 덮지 않는 경우를 검증한다.
- 상세 관전 복원 테스트의 로그 조회는 실패 응답으로 격리해 라우팅만 검사한다. 실제 레이스 진행/완료 검증은 기존 `server-race-flow.integration.ts`가 담당한다.


## Vercel 보호된 API Preview 연결 (2026-10-17)

- Next 서버의 `DERBY_API_URL`은 배포된 `derby-career-api`의 HTTPS origin으로 설정한다. 브라우저는 여전히 Next의 동일 출처 `/api/racing-catalog/*`만 호출한다.
- Backend의 Vercel Authentication은 유지한다. 전용 서버 간 요청용 `DERBY_CATALOG_UPSTREAM_BYPASS_TOKEN`을 **Next 서버 전용 Sensitive 환경변수**로 설정한다. 원본 토큰을 저장소, `NEXT_PUBLIC_` 변수, 로그, 브라우저 헤더에 절대 넣지 않는다.
- Next 프록시가 Vercel Backend로 요청할 때만 `x-vercel-protection-bypass` 헤더를 붙인다. HTTP upstream에는 이 토큰을 전달하지 않는다. 브라우저의 Cookie/Authorization은 전달하지 않는다.
- 해당 토큰은 프로젝트 전반의 배포 보호를 우회할 수 있으므로 서버 용도로만 보관하고, 불필요해지면 철회한다. 장기적으로 Vercel Trusted Sources가 지원되면 Preview→Preview OIDC 접근 규칙을 사용하고 우회 토큰을 폐기한다.
- 환경변수 변경 후 **새 Preview 배포**가 필요하다. 실제 검증은 FE 경주 목록 API가 200과 계약에 맞는 JSON을 반환하는지 확인하고, 실패하면 `X-Derby-Catalog-Failure`/상위 HTTP 상태를 확인한다.
