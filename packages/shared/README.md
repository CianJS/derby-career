# 공유 코드

- `src/domain.ts`: 기존 `lib/career`의 순수 도메인 재내보내기. 브라우저 store/repository는 제외한다.
- `src/server-domain.ts`: 공유 계산을 사용하면서 Local fixture 이벤트를 등록하지 않는 서버 권한 모드. API 신규 경주의 기본 엔진은 공유 v4이며 v1/v2/v3 지정 요청과 과거 로그도 유지한다.
- `src/events.ts`: 직렬화 가능한 이벤트 조건·효과·Director 설정.
- `src/generated/event-validation.mjs`와 `.d.mts`: OpenAPI에서 생성한 의존성 없는 이벤트 응답 검증기와 타입 선언.
- `src/generated/save-validation.mjs`와 `.d.mts`: 같은 생성 절차로 만든 서버 저장 명령·workspace·응답 검증기. 출전 조회·확정·RaceRun·Log·완료 요청/응답도 검사하며 브라우저와 Next bridge 양쪽에서 사용한다.
- `src/event-catalog-validation.ts`: 외부 JSON 검증과 공개 source 정보 투영.
- `src/generated/api.ts`: `contracts/openapi.yaml`에서 생성한 HTTP 타입.
- `src/client.ts`: 공통 타입 기반 API 클라이언트. 재시도용 ID는 호출자가 유지한다. `getCareerWorkspace()`는 현재 마방·활성 Career·행동 UUID·페이지 단위 은퇴 기록을 복원한다. `retireCareer(id, { commandId, expectedRevision })`는 서버 은퇴를 확정하고 `getRetirement(id)`는 은퇴 당시의 불변 snapshot을 조회한다.
  `getRaceEntryOptions(id)`는 현재 월 경주별 제한 사유와 실제 계약 기수를 조회한다. `enterRace` → `getRaceRun`/`getRaceLog` → `completeRace`는 저장된 버전의 Log를 사용하며, 완료가 다음 월까지 진행한다. 실제 엔진 버전은 Run의 입력 계약 버전이 아닌 `simulation.engineVersion`과 metadata/Log에서 읽는다.
- `src/event-catalog-adapter.ts`: 공개 이벤트 읽기만 제공하는 최소 Adapter.
- `src/event-catalog-proxy.ts`: Next 서버가 사용하는 공개 목록·상세 조회. query 검증, 서버 주소 설정, timeout, 오류 응답을 처리하며 브라우저 자격증명은 전달하지 않는다.

이 패키지는 저장소 안에서 사용한다. 프론트엔드는 기존 `@/packages/shared/src/...` 경로로, API는 상대 경로로 참조하고 서버 빌드 시 공유 도메인을 번들한다. 루트 frontend와 API의 실행·배포·lockfile을 분리했으며 root package manager 설정을 바꾸지 않았다. 코드와 계약의 변경 공유 경로는 GitHub PR이며 다른 대화로 자동 전달하지 않는다.

- 신뢰도: `domain.ts`의 `jockey-trust.ts` 재내보내기로 Local/Server가 성장·하락·이벤트 규칙을 공유한다. `Career.jockeyTrust`, 출전 `trustContext`, 전적 `trustChange`는 이전 저장에 없는 경우도 지원한다. 신규 `getJockeyRelations(careerId)`는 현역/은퇴 관계를 소유자 범위로 조회한다. 사용자 명칭은 신뢰도이며 기존 Snapshot의 chemistry 필드명은 유지한다. 자세한 계약은 [API 신뢰도 문서](../../services/api/docs/jockey-trust.md)를 따른다.
