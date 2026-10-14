# DERBY CAREER 코드 책임과 리팩터링 경계

이 문서는 `develop`의 Frontend, Backend, 공유 라이브러리, API 연동, 테스트와 CI를 함께 검토한 뒤 정리한 책임 지도다. 게임 동작을 변경하는 설계 제안이 아니다.

## 책임 지도

| 영역                                                                                        | 책임과 의존 방향                                                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `app`                                                                                       | Next 페이지 진입점과 서버 전용 API bridge. 브라우저에 서버 token을 전달하지 않는다.                     |
| `components/legacy-career.tsx`                                                              | 기존 화면 전환, 로컬 마방 상태, 서버 workspace 투영과 저장 effect를 조율한다.                           |
| `components/career/navigation.tsx`, `presentation.tsx`, `management.tsx`                    | 내비게이션, 공통 시각 요소, 관리 화면의 레이아웃. 저장 또는 게임 계산을 수행하지 않는다.                |
| `components/career/stable.tsx`, `horse-record.tsx`, `race-catalog.tsx`, `jockey-record.tsx` | 마구간·말 기록·경주 정보·기수 정보 표시. 기존 필터, 표시 데이터와 콜백을 유지한다.                      |
| `components/career/legacy-types.ts`, `legacy-catalog.ts`                                    | 레거시 화면의 타입과 기존 표시용 경주·기수 목록. 공식 서버 카탈로그의 대체 구현이 아니다.               |
| 기존 `components/career`의 육성·출전·중계·결과 화면                                         | `careerStore`의 현재 상태와 저장된 로그를 사용한다. 서버 결과를 로컬에서 다시 계산하지 않는다.          |
| `lib/career/model.ts`, 이벤트·건강·레이스 모듈                                              | 공유 순수 게임 규칙, 기존 RNG, 엔진 버전, 저장 검증. UI와 DB에 의존하지 않는다.                         |
| `lib/career/store.ts`, 브라우저 저장·repository 모듈                                        | Web Locks, 원자적 Local Save, 레거시 저장 이전, 탭 충돌과 레이스 로그 복원.                             |
| `lib/server-save`                                                                           | bridge의 요청 경계, 명령 journal, 미확정 응답 재시도와 최신 서버 workspace 조회.                        |
| `lib/event-catalog`, `components/dev`, `packages/shared/src/event-catalog-*`                | 공개 이벤트의 계약 검증, 조회, 취소·오래된 응답 차단과 개발용 표시.                                     |
| `packages/shared/src/client.ts`                                                             | 공개 API 메서드와 생성 계약 타입. 기존 import와 메서드 서명을 유지한다.                                 |
| `packages/shared/src/api-transport.ts`                                                      | HTTP 직렬화, 매 요청의 세션 token 읽기, 캐시·credential 정책과 API 오류. 도메인 결과를 계산하지 않는다. |
| `services/api/src/routes`, 인증·contracts 모듈                                              | Fastify 요청 검증, 소유자 인증, HTTP 직렬화.                                                            |
| `services/api/src/repositories/careers.ts`                                                  | Career와 마방의 작업 조율, 행동·은퇴·경주 저장. 공유 도메인 함수를 그대로 사용한다.                     |
| `services/api/src/repositories/career-commands.ts`                                          | principal 잠금, 소유권 확인, 요청 hash, receipt 재생·저장과 UUID 충돌 처리.                             |
| `services/api/src/repositories/career-events.ts`                                            | 같은 transaction 안에서 이벤트 draw, history, 선택, modifier 소비와 월 종료를 처리한다.                 |
| `services/api/src/repositories/career-rows.ts`                                              | 소유자 범위의 Career/history 조회와 기존 응답 투영.                                                     |
| DB·migration·seed·인증 서비스                                                               | PostgreSQL 연결, 불변 이력, 초기 카탈로그와 인증. migration과 seed를 변경하지 않았다.                   |
| `tests`, `services/api/tests`, `scripts`                                                    | Local Save, 고정 digest, 서버 연동, 계약·인증·DB 회귀 검증과 감사 도구.                                 |
| `.github/workflows`, lint·format 설정                                                       | 기존 CI 검사. 새 화면 파일도 lint·format 대상이며 format/check는 같은 대상 목록을 사용한다.             |

## 보존해야 하는 경계

- Local Save와 서버 저장은 서로 다른 authoritative 경로다. 키·문서 구조·이전 절차를 변경하지 않는다.
- 미확정 서버 명령은 최초 UUID와 본문으로 재시도한다. receipt의 과거 상태 대신 최신 workspace를 표시한다.
- 잠금은 principal → Career 순서다. 이벤트, 보상, 상태와 receipt는 호출자가 연 동일한 transaction에 남는다. 이벤트 repository가 독립 transaction을 만들지 않는다.
- 기존 레이스 로그의 JSON 필드 순서, digest와 v1/v2/v3 호환성을 유지한다. 표시용 레거시 시뮬레이션의 미사용 코드 제거는 실제 공유 엔진을 변경하지 않는다.
- `DerbyApiError`는 기존 `client.ts`에서 재내보내므로 기존 `instanceof` 확인과 import가 동일한 클래스를 사용한다. 성공 응답의 런타임 검증은 기존 adapter/controller와 생성 검증기에 남는다.
- 생성 계약 파일, OpenAPI, 이벤트 seed, migration, 밸런스, 고정 테스트 fixture는 수정하지 않았다.

## 안전한 후속 작업

- `legacy-career.tsx`의 화면 전환·저장 effect와 기존 `Training` 데모 표현은 남아 있다. 실제 브라우저의 클릭·새로고침·탭 교체 검증 없이 effect 순서나 오래된 표시 내용을 바꾸지 않는다.
- `careerStore`와 서버 controller의 비동기 수명·취소 정책, 브라우저 저장 검증을 추가로 합치지 않았다. 두 저장 경로의 오류·복구 규칙이 다르다.
- Career의 경주 SQL 및 일부 DB JSON 행은 여전히 저장소에서 처리한다. 모든 DB 결과를 새 도메인 모델로 바꾸거나 기존 예외를 재분류하는 작업은 별도 회귀 범위가 필요하다.
- 레이스 엔진·이벤트 RNG·공유 계산은 변경하지 않는다. 순서와 부동소수점 계산의 동등성은 단순한 코드 정리만으로 보장되지 않는다.
- 화면 전체의 포맷을 일괄 변경하지 않았다. 수정하지 않은 UI, 인증, 카탈로그 조회와 계약 생성기의 추상화는 현재 테스트 경계를 유지한다.
- PR #14의 이벤트 확장 구현을 가져오지 않았다. `careers.ts`의 이벤트 호출 위치가 새 `career-events.ts`로 옮겨졌으므로 해당 PR 병합 시 월간 draw 변경을 이 모듈에도 반영하고 이벤트·DB 회귀를 다시 실행해야 한다.

검증 명령은 루트 및 API `README.md`와 `.github/workflows/backend-foundation.yml`을 따른다. 실제 브라우저 E2E 검증은 Node 렌더링·저장 테스트나 PostgreSQL 통합 테스트로 대체되지 않는다.
