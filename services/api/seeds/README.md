# 이벤트 import

원본은 2026-10-12에 조회한 Notion 이벤트 목록이다.

- `events.import.json`: 실제 350개 ID·이름·게임 속성·이벤트 설명만 보존한 공개 변환 입력. Notion 페이지 본문·개별 페이지 URL·수정 시각은 포함하지 않는다.
- `events.catalog.json`: version 1의 검증된 구조화 Seed. 315개 candidate enabled, 경주 준비 35개 deferred/disabled.

원본 Notion export와 출처 페이지·데이터베이스 주소는 저장소에 커밋하지 않는다. 새 원본은 저장소 밖의 경로에서 converter에 전달한다.

일반·특별·사고·히든의 미작성 목표 수량은 생성하지 않았다. 후보 315개는 **수치가 밸런스 확정됐다는 뜻이 아니다.** `balanceVersion=notion-proposal-2026-10-12`, 기본 weight=1의 개발 초안이다.

API 디렉터리에서 변환·검증·적용한다.

```bash
npm run events:convert
npm run events:import -- seeds/events.catalog.json
```

Notion CSV export나 `{rows:[...]}` JSON도 받을 수 있다. CSV에는 `이벤트 ID, 이벤트명, 대분류, 도입, 등장조건, 발동시점, 선택·효과, 세부유형` 열이 필요하고 `description,url,body`는 선택이다. `description`이 있으면 설명으로 사용하고, 없으면 `body`의 인용 문장에서 추출한다. UTF-8 BOM, 따옴표, 쉼표, 여러 줄 셀을 지원한다. ID 누락·중복·알 수 없는 카테고리는 전체 import를 거부한다.

```bash
npm run events:convert -- /path/events.csv /path/events.catalog.json
npm run events:import -- /path/events.catalog.json
```

문자열 문법 해석은 import 시에만 수행한다. 런타임은 `conditions`, `choices`, `effects`의 명시적 타입만 실행한다. 알 수 없는 조건/효과는 `needs_mapping`, `enabled=false`와 원문으로 보존한다. 일부 효과만 실행하는 추정 변환은 하지 않는다. 새 문법은 converter와 검증을 함께 확장하거나 JSON에서 명시적 타입으로 작성한다.

구조화 JSON을 편집한 경우 이벤트의 `revision`은 해당 이벤트에서 revision 필드를 제외한 canonical JSON의 SHA-256이다. `src/services/identity.ts`의 `digest()`로 갱신한다. import는 체크섬을 검증한 후 event revision / choice / effect를 트랜잭션으로 upsert한다. 동일 Seed를 재적용해도 기존 revision이 중복되지 않는다. 제거된 원본 항목을 자동 삭제하지 않는다. 비활성화도 새 revision의 `enabled=false`로 명시한다.

월 시작에 이벤트 풀·revision·설정·Seed를 저장한다. 이미 열린 월의 풀과 이미 제공된 선택지는 카탈로그가 갱신돼도 바뀌지 않는다. 확률은 한 달에 한 번 판정하며 최대 1개 이벤트만 기록한다. 기본 확률 30%, 시작/결과 시점 분배 `monthStartShare=0.5`, 3개월 연속 미발생 후 다음 eligible 월의 보정이다. 결과 시점에 맞는 행동/풀이 없으면 이벤트가 발생하지 않을 수 있다. 보정 월에는 시작 이벤트 풀이 있으면 우선 확정한다. 설정 변경은 새 월부터 적용한다.

집중 조교는 해당 월의 조건부 modifier를 자동 등록하고, 다른 행동을 하면 만료한다. 훈련 대성공·휴식/치료 결과는 확정한 행동의 결과에 자동 적용한다. A/B 이벤트만 선택 API로 확정하며 추가 핵심 행동을 소비하지 않는다. 성장 보너스는 저장된 성장량 기준, 반올림, 능력 상한 1000 및 최소 0을 적용한다. 기존 공유 훈련 함수에 없는 연령/둔화 공식을 별도로 복제하지 않았다. 엔진·Resolver의 기존 버전을 변경하는 밸런스 작업은 버전 갱신과 공유 도메인 조율이 필요하다.
