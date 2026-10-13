# 공유 코드

- `src/domain.ts`: 기존 `lib/career`의 순수 도메인 재내보내기. 브라우저 store/repository는 제외한다.
- `src/server-domain.ts`: 공유 계산을 사용하면서 Local fixture 이벤트를 등록하지 않는 서버 권한 모드. API 기본 엔진은 명시적 v2이며 최신 frontend의 v3 기본값과 구분한다.
- `src/events.ts`: 직렬화 가능한 이벤트 조건·효과·Director 설정.
- `src/generated/event-validation.mjs`와 `.d.mts`: OpenAPI에서 생성한 의존성 없는 이벤트 응답 검증기와 타입 선언.
- `src/event-catalog-validation.ts`: 외부 JSON 검증과 공개 source 정보 투영.
- `src/generated/api.ts`: `contracts/openapi.yaml`에서 생성한 HTTP 타입.
- `src/client.ts`: 공통 타입 기반 API 클라이언트. 재시도용 ID는 호출자가 유지한다.
- `src/event-catalog-adapter.ts`: 공개 이벤트 읽기만 제공하는 최소 Adapter.
- `src/event-catalog-proxy.ts`: Next 서버가 사용하는 공개 목록·상세 조회. query 검증, 서버 주소 설정, timeout, 오류 응답을 처리하며 브라우저 자격증명은 전달하지 않는다.

이 패키지는 저장소 안에서 사용한다. 프론트엔드는 기존 `@/packages/shared/src/...` 경로로, API는 상대 경로로 참조하고 서버 빌드 시 공유 도메인을 번들한다. 루트 frontend와 API의 실행·배포·lockfile을 분리했으며 root package manager 설정을 바꾸지 않았다. 코드와 계약의 변경 공유 경로는 GitHub PR이며 다른 대화로 자동 전달하지 않는다.
