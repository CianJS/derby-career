# 이벤트 import

**현재 등록 입력은 events.expansion.source.json이며, events.drafts.import.json은 P1 당시의 역사 snapshot이다. 최신 Notion 개정과 비교한 20개 차이 및 이전/현재 원문은 reports/event-expansion.json의 sourceComparison을 확인한다. 이전 CSV 전체는 archives/에 보관한다. 현재 게임 적용 승인과는 별개다.**

기존 공통 원본은 2026-10-12, 신규 보류 항목의 속성 snapshot은 2026-10-14에 조회한 Notion 이벤트 목록이다.

- `events.import.json`: 실제 350개 ID·이름·게임 속성·이벤트 설명만 보존한 공개 변환 입력. Notion 페이지 본문·개별 페이지 URL·수정 시각은 포함하지 않는다.
- `events.catalog.json`: version 1의 검증된 구조화 Seed. 315개 candidate enabled, 경주 준비 35개 deferred/disabled.
- `events.drafts.import.json`: 신규 650개(일반 350 / 특별 150 / 사고 100 / 히든 50)의 게임 속성 8개만 보존한 공개 검사 입력. 모두 `보류`다. 개별 페이지 URL·본문·수정 시각을 포함하지 않으며 `db:seed`가 읽지 않는다.

원본 Notion export와 출처 페이지·데이터베이스 주소는 저장소에 커밋하지 않는다. 새 원본은 저장소 밖의 경로에서 converter에 전달한다.

전체 작성 수량은 1,000개지만 **작성과 게임 적용은 별개**다. 기존 후보 315개도 **수치가 밸런스 확정됐다는 뜻이 아니다.** `balanceVersion=notion-proposal-2026-10-12`, 기본 weight=1의 개발 초안이다. 신규 650개를 기본 Seed에 합치거나 자동 활성화하지 않는다.

## 확장 사전 검사와 비활성 가져오기

검사 도구는 DB·Notion credential 없이 CSV 또는 `{rows:[...]}` JSON을 읽는다. 신규 가져오기 입력에는 비공통 `보류` 항목만 준비한다. 기존 공통이 포함된 전체 export는 오류로 보고하며 조용히 건너뛰지 않는다. 기존 구조화 카탈로그 `{schemaVersion:1,events:[...]}`도 검사할 수 있다. 필수 속성은 아래 기존 CSV 열과 같으며, 고정 서술을 검증하려면 선택 필드 `description`을 별도로 제공한다. URL·본문은 신규 격리 파일에서 제외한다.

```bash
npm run events:check -- seeds/events.catalog.json /tmp/existing-report.json
npm run events:check -- seeds/events.drafts.import.json /tmp/draft-report.json /tmp/event-drafts.json
```

`error`는 필수 값·ID 충돌·잘못된 스키마/범위·체크섬 등이며 종료 코드 1과 함께 새 격리 파일을 만들지 않는다. `unmapped`는 기존 문자열 문법이 지원하지 않는 항목, `engine_gap`은 현재 타입/실행 시점에 없는 기능의 검토 분류, `review`는 기획·본문 확인이 필요한 사항이다. 기능어 기반 분류는 의미를 자동으로 해석했다는 뜻이 아니다. 조건과 효과는 각각 검사하므로 첫 조건 오류가 효과 검사를 숨기지 않는다.

`unmapped`/`engine_gap`이 있어도 종료 코드 0으로 **비활성 내용 보존용** 파일을 생성할 수 있다. 출력은 `importMode: 'drafts'`를 가진 별도 packet이며 일반 `events:import`는 거부한다. 격리 항목은 `introduction: 'hold'`, `enabled: false`, `status: 'needs_mapping' | 'deferred'`, `automatic: false`, 빈 `conditions`/`choices`와 원문 조건·효과를 가진다. 지원된 일부 효과를 실행하거나 다른 효과로 대체하지 않는다. `weight=1`은 기존 스키마의 필수 양수 자리이며, 격리 항목에는 추첨 가중치로 사용되지 않는다.

명시적으로 설정된 DB에 격리 packet만 적용하는 절차다. 이번 PR에서는 운영 DB에 적용하지 않았고 테스트 DB에서만 검증했다.

```bash
npm run events:import-drafts -- /tmp/event-drafts.json
```

가져오기는 revision·sourceDigest·비실행 상태를 재검증하고 기존 importer와 같은 advisory lock/트랜잭션을 사용한다. 기존 공통 및 검토 완료 항목은 덮어쓰지 않는다. 같은 원본·revision 재적용은 PK/upsert로 정의·revision·선택지·효과를 중복 생성하지 않으며, 이미 격리된 초안의 수정은 새 revision으로 보존한다. 파일을 편집해 활성화하거나 실행 조건/효과를 추가하면 이 명령이 거부한다. 원본/기존 공통 Seed를 검사 출력 경로로 지정할 수도 없다. 실패 시 이전 출력 파일은 보존하므로 현재 보고서의 `sourceDigest`/`draftPacket` 결과를 확인한다.

기존 `db:seed` 및 월간 풀의 `enabled=true AND status='ready'` 필터는 그대로다. 공통 350개는 원본 바이트·변환 결과·확률 설정과 3,840개 고정 Seed 추첨/선택 효과 관측으로 회귀 검증한다. 미지원 목록과 실제 조회/본문 검증 범위는 [확장 검토 결과](../reports/event-catalog-expansion.md)에 기록한다. 공개 API는 활성·검토 완료·비히든만 반환한다. 비활성·보류·히든은 공개 목록/ID 조회로 확인할 수 없다. 관리 검토에는 원본·보고서와 명시적인 내부 DB 조회를 사용한다.

## 기존 공통 350개 변환

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

## 최신 전체 CSV 확장

`events.expansion.source.json`은 보관 CSV를 기준으로 Notion 속성 1,000개를 대조한 현행 입력이다. 신규 20개의 이름·조건·효과 개정을 반영하며, Notion에 없는 검토용 사건그룹 ID는 감사 CSV 값을 보존한다. 본문/효과 승인 전의 원문은 실행 가능한 위험 선택으로 추정하지 않는다. 기존 `events.import.json`과 `events.catalog.json`의 공통 350개는 변경하지 않는다. `npm run events:expand -- <CSV>`로 원본과 신규 650개 구조화 Seed, 검토 보고서를 함께 생성한다. 인자 없는 재생성은 동일 결과를 유지해야 한다. `db:seed` 또는 `events:import-expansion`으로 신규 정의를 비활성 등록한다. 모든 원본 ID가 유지된다.

`events.expansion.catalog.json`은 변환 결과이고 `reports/event-expansion.json`은 변환/실행/검토/활성 수, 미지원 원문 및 ID, 사건그룹과 동일 규칙 묶음을 기록한다. 같은 효과를 다른 효과로 치환하거나 그룹 대표 ID를 자동 정하지 않는다. 위험 판정 시스템은 지원하지만 개정 원문에 적힌 위험 효과 제안은 승인된 구조화 결과가 아니다. 이를 임의로 해석해 실제 위험 선택으로 바꾸지 않는다.

활성화 절차와 revision을 고정한 검토 manifest는 API README를 따른다. 이전 `events.drafts.import.json`/P1 검증기는 과거 격리 경로의 회귀 검증을 위해 보존한다. 최신 원본 및 현재 변환 수를 판단할 때는 expansion 파일을 사용한다.

`events:check`는 입력 경로를 명시해야 한다. 인자 없이 오래된 P1 snapshot을 최신 원본으로 오인해 처리하지 않는다. 과거 snapshot을 지정한 검사는 재현 목적이며, 현재 650개 등록에는 events:expand와 expansion import 경로를 사용한다.
