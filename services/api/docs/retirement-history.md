# 은퇴 Career 이력 조회 (UX-15 A)

`GET /v1/careers/{careerId}/expeditions/history?page=1&pageSize=20`은 현재/은퇴 Career의 실제 `stable_expeditions` 행을 읽는다. 기존 소유자 인증 후 Career ID와 해당 stable ID를 함께 제한한다. 다른 소유자/없는 Career는 404, 인증 누락은 401, 잘못된 UUID/페이지/알 수 없는 query는 400이다. 인증 비활성 모드의 기존 503 정책을 따른다.

새 migration/테이블/저장 명령은 없다. `REPEATABLE READ READ ONLY` transaction과 기존 `expeditionDto`를 사용하며 은퇴 snapshot, 현재 여행, 자금/정산, 레이스/행동/이벤트, 신뢰도, 명령 receipt를 쓰거나 재계산하지 않는다.

## 응답과 Client

```ts
import { createApiClient } from '../../../packages/shared/src/client'
import type { components } from '../../../packages/shared/src/generated/api'
import { validateExpeditionHistory } from '../../../packages/shared/src/generated/save-validation.mjs'

type ExpeditionHistory = components['schemas']['ExpeditionHistory']
// { data: components['schemas']['Expedition'][], page: number, pageSize: number }
const client = createApiClient({ baseUrl: apiUrl, getSessionToken })
const result: ExpeditionHistory = await client.getExpeditionHistory(careerId, {
  page: 1,
  pageSize: 20,
})
// 외부 JSON을 받는 경계에서 생성 검증기를 사용한다.
if (!validateExpeditionHistory(result)) {
  throw new Error('원정 이력 응답이 계약과 다릅니다.')
}
```

기본 page=1, pageSize=20, 최대 page=100000/pageSize=100이다. 응답은 기존 Career 이력 형식과 같은 `{ data, page, pageSize }`이며 total/cursor 필드는 없다. 빈 data로 마지막 페이지를 확인한다. `startedTurn DESC, createdAt DESC, id DESC`의 결정적 정렬을 사용한다. 데이터가 동일하면 페이지 사이 중복/누락이 없으며 같은 턴/같은 timestamp도 ID로 구분한다. 활성 Career에 원정이 추가되는 동안 여러 요청 전체를 고정하는 cursor/snapshot은 제공하지 않는다.

- `targetCountry`: DB의 방문 목적국. 출발 당시 소속국을 기록한 별도 필드는 없으므로 현재 마방 국가로 소급 추정하지 않는다.
- `startedTurn`, `endedTurn`: 해당 Career의 절대 육성 턴. 61 이상도 보존하며 1~12 시즌 차수로 바꾸지 않는다. 당월 귀국은 같은 값이다.
- `status=active`: 진행 중이며 endedTurn/endReason/endedAt은 null이다.
- `status=returned, endReason=return`: 실제 귀국 명령으로 종료된 원정이다.
- `status=returned, endReason=retirement`: 은퇴 처리에서 자동 종료된 원정이다. 일반 귀국으로 바꾸지 않는다.
- `targetRaceDefinitionId`와 날짜의 nullable 의미 및 기존 `Expedition` 전체 필드를 그대로 반환한다. createdAt/endedAt은 DB 기록 시각(UTC)이며 게임 달력 날짜와 다르다.

기존 단수 `GET /expedition`은 여전히 **현재 마방**의 여행 상태다. 이전 말의 Career ID로 호출해도 다음 육성마의 현재 원정이 나올 수 있으므로 과거 이력 대용으로 쓰지 않는다. 새 복수 경로는 해당 Career 기록만 반환한다.

## FE #90의 네 이력 출처

| 경로 (`/v1/careers/{careerId}` 뒤) | 공유 Client            | 응답 타입           |
| ---------------------------------- | ---------------------- | ------------------- |
| `/actions`                         | `listActions`          | `ActionList`        |
| `/events`                          | `listCareerEvents`     | `CareerEventList`   |
| `/records`                         | `listRecords`          | `RecordList`        |
| `/expeditions/history`             | `getExpeditionHistory` | `ExpeditionHistory` |

네 경로 모두 은퇴 Career와 `{page,pageSize}`를 지원한다. 기존 은퇴 조회의 `RetirementRecord.snapshot`은 당시 불변 상태이며 위 네 API는 저장된 개별 행이다. 중복 timeline 저장소/aggregate API를 추가하지 않는다. 현재 로컬 개발용 Next bridge에는 이력 경로가 허용되어 있지 않다. FE #90에서 기존 bridge 인증/허용 경로/페이지 query/응답 검증 방식으로 연결해야 하며 토큰을 브라우저로 전달하면 안 된다. 이번 Backend PR에는 Next bridge·화면·Local Save 변경이 없다.

## 테스트 성공 응답 발췌

아래 값은 API 명령으로 출국/귀국/경주/은퇴/다음 말 생성을 실행한 회귀 테스트에서 검증한다. 읽기 편하게 ID·설명·시간 등의 나머지 필드만 생략했다.

- 원정 첫 페이지(page=1,pageSize=2): `[{targetCountry:'JPN',startedTurn:7,endedTurn:7,endReason:'retirement'}, {targetCountry:'USA',startedTurn:4,endedTurn:4,endReason:'return'}]`. 전체 5행은 JPN(3→3), USA(3→4), JPN(4→4), USA(4→4), JPN(7→은퇴)이며 다음 육성마의 활성 USA 원정과 분리된다.
- 행동 첫 페이지(page=1,pageSize=2): `[{turn:6,kind:'race'}, {turn:5,kind:'rest'}]`. 전체 페이지는 turn 6,5,4,3,2,1을 반환한다.
- 경주 기록(pageSize=1): 1·2페이지의 저장된 `career_record`가 각각 6턴/3턴 경주 DB 원문과 일치하고 3페이지는 빈 배열이다. 결과/상금/엔진 로그를 다시 계산하지 않는다.
- 별도 이벤트 회귀(pageSize=1): 1페이지는 `{turn:2,state:'pending',choiceId:null,result:null}`, 2페이지는 `{turn:1,state:'expired',choiceId:'B'}`. 은퇴 후 조회로 선택·성공 결과가 생기지 않는다.

## 기록의 한계

DB에 명시적 원정 행이 없는 옛 Server Save나 Local Save의 원정을 만들어내지 않는다. 이벤트는 실제 제시된 저장 Snapshot과 상태/결과만 제공한다. pending/expired 또는 result=null을 성공·적용으로 해석하지 않는다. 아직 제시되지 않은 비공개/히든 카탈로그를 추가 노출하지 않는다. 은퇴 요약의 최종 능력치에서 개별 성장 사건을 역산하거나 날짜/원정/기수 변화를 추정하지 않는다. Local 기록 보존과 타임라인 구성은 FE #90의 후속 범위다.
