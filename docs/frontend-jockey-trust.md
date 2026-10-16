# 기수 신뢰도 Frontend 연동

기준은 Backend PR #34와 카탈로그 QA PR #35가 반영된 develop이다. 공유 `lib/career/jockey-trust.ts`는 Backend 구현을 그대로 유지한다. 이전 FE 표시 함수는 `jockey-trust-presentation.ts`로 분리하고, API DTO 조회/생성 검증기는 `lib/server-save/jockey-relations.ts`에 두어 서버 저장 그래프가 UI store·React에 의존하지 않게 했다.

## 조회와 저장 경계

- Local 현역은 공유 `jockeyTrust(career, id)`를 읽는다. 신규 관계와 구버전 map 부재의 초기 0은 공유 도메인 정책이며 과거 경주를 재생해 소급 성장시키지 않는다. 기수 변경으로 관계를 지우지 않는다.
- Server는 최신 Workspace `state.jockeyTrust`와 소유자 범위 `GET /v1/careers/{careerId}/jockey-relations`를 함께 검증한다. Career ID, ownedHorseId, revision, active/retired 상태, 기수별 starts/trust가 불일치하면 숫자를 표시하지 않는다.
- 미조회·조회 오류·로딩·육성마 없음과 실제 0을 구별한다. 경주 Snapshot chemistry는 현재 관계값의 대용으로 쓰지 않는다.
- 은퇴 Local은 보존된 `LifecycleHorse.jockeyTrust`만 표시한다. 옛 archive에 map이 없으면 정보 없음이다. Server archive는 해당 은퇴 Career ID/말 ID/revision으로 관계 endpoint를 조회하며 현역 값으로 대체하지 않는다. 실패 시 읽기 재시도를 제공한다.
- 저장, 이전, 완료, 은퇴는 기존 공유 도메인/Browser Save/ServerSaveController와 Journal을 사용한다. FE에서 신뢰도 계산이나 추가 업로드를 수행하지 않는다.

## 확정된 결과

경주 관전과 완료 전에는 변화 정보 없음을 표시한다. 완료 후 최신 저장 전적의 `trustChange`를 표시하며 증가/감소/명시적 0/기록 부재를 구분한다. 같은 결과 화면에서 확정 내역을 읽은 뒤 이미 진행된 다음 달의 육성으로 돌아간다. 두 번째 월 진행 명령은 보내지 않는다. 결과 화면을 보관하는 상태에는 말/저장 모드 식별자를 포함한다.

네트워크 응답이 불확실하면 새 완료 UUID를 만들지 않고 기존 Journal의 요청을 다시 확인한다. 화면 재열람과 은퇴 상세는 저장된 receipt를 읽기만 한다. 새 출전 기본 v4와 기존 v1/v2/v3 저장 로그를 동일한 Adapter/Playback으로 표시한다.

## 이벤트 경계 및 남은 계약

Server의 확정 `event.result.trustChanges[]`가 있을 때 기수 이름, before/after/delta를 표시한다. 빈 배열/필드 부재에는 변화가 있었다고 표시하지 않는다. 공유 `applyTrustEvent`가 확정한 receipt를 사용하는 표시 테스트로 증가·감소·0과 재열람 무변경을 검증한다.

**현재 실제 신뢰도 이벤트 콘텐츠는 0개다.** 제품 카탈로그/이벤트를 추가하지 않았다. 실제 콘텐츠의 신뢰도 이벤트 전체 흐름을 검증했다고 주장하지 않는다.

Local 공유 `chooseEvent`/`resolveAction`은 `applyTrustEvent(...).career`를 저장하지만 반환된 `change`를 `CareerEvent`/`AppliedEvent`에 보존하지 않는다. FE는 없는 필드를 가정하거나 before/after를 역산하여 가짜 이력을 만들지 않는다. Local 이벤트의 영속 증감 이력 표시에는 Backend/공유 담당이 선택 결과와 행동 결과에 확정 receipt 배열을 선택 필드로 보존하는 계약이 필요하다. 공유 계산 변경 없이 가능한 현재 관계/저장/경주/은퇴 표시와 Server 이벤트 표시를 완료했다. 후속 계약이 생기면 동일한 `EventTrustChanges`에 연결할 수 있다.

## 검증 환경

기존 CI의 PostgreSQL 17 + Fastify + production Next + 고정 Playwright Chromium을 유지한다. Server 브라우저 검증에는 별도의 loopback Fastify 개발 모드와 Next dev를 띄워 **기존 개발 세션** bridge를 사용한다. 테스트 DB의 임시 세션 토큰은 서버 환경에만 전달하며 로그/브라우저/아티팩트에 저장하지 않는다. production bridge 차단은 변경하지 않는다.

Local은 실제 공유 v4 엔진/완료 로직의 증가·감소·0 사례를 사용해 결과/새로고침/은퇴/새 말 초기화를 검증한다. Server는 실제 HTTP와 DB로 Month 1~7, Month 3/6 경주, 관전/출전 직후 새로고침, 응답 유실과 동일 요청 재시도/중복 완료, 관계 보존과 Local 미혼합을 검증한다. 기존 소유권/리비전/말 전환 통합 검사와 v1/v2/v3/v4 Playback 회귀를 유지한다. 실행 결과와 증거는 PR #33 본문에 기록한다.
