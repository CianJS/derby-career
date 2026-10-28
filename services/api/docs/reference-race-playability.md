# 공식 참고 경주 → 출전 연결 1단계 (#100)

기준 develop e06bad2. **실제 추가 playable: 0 / 원본 851행 (공개 목록 848개)**. 기존 게임 경주 19개는 그대로다. 이번 PR은 미검증 경주를 활성화하지 않고 FE가 상세/출전 동선을 정확하게 구분할 읽기 계약을 제공한다. 실제 공식 경주 출전 활성화는 아직 미완료다.

## 원인과 계약

기존 공개 일정의 gameEnabled=false와 source ID는 참고 자료의 상태다. DB의 race_definitions 출전 ID로 바꿔 쓰면 안 된다. 원본·DB 행을 변경하지 않고 응답에 선택 필드 playability를 덧붙인다.

- GET /v1/race-schedule 및 /{id}: playability = {sourceRaceId, sourceYear, sourceMonth, raceDefinitionId:null, status:'blocked', eligible:false, calendarPolicy:'not_approved', reasons:[]}.
- 기존 소유자 인증 GET /v1/careers/{careerId}/race-entries?referenceRaceId=RACE_...: 정확한 referenceRace와 빈 races, 보류 안내를 반환한다. 없는 ID/다른 소유자는 404, 잘못된/중복 query는 400. 조회가 action/seed/원장/여행/로그를 생성하지 않는다.
- query 없는 기존 API·POST 출전 계약은 유지한다. 참고 ID나 eligible=true로 기존 POST 검증을 우회할 수 없다. 기존 국가/승수/건강/자금/기수/원정/locked race 검증은 변경하지 않는다.
- 공유 Client getRaceEntryOptions(careerId, {referenceRaceId})와 생성 validator를 사용한다. 기존 한 인자 호출은 호환된다. referenceRaceId는 출전 가능한 raceDefinitionId가 아니다.
- Local에서도 packages/shared/src/race-playability의 순수 판정을 사용할 수 있다. 실제 Local 경주 목록/저장 형식·UI는 변경하지 않았다.

## 2026 → 육성 시즌

sourceYear/sourceMonth는 원본 개최일의 정보다. 2028+ 육성 달력에 자동 반복시키는 승인은 없다. calendarPolicy=not_approved인 경주를 turn/시즌에 투영하지 않는다. 기존 DEV 경주의 3/6/9/12월 반복 및 61턴 이후 occurrence 계산은 그대로 보존한다. 미래 활성화 시 시즌 월 매핑·연령·성별·승수·원정 자격을 별도 승인하고, 공유 occurrence/eligibility 및 authoritative POST에 함께 연결해야 한다.

## 제외 보고서와 다음 승인 요건

services/api/reports/race-playability.json은 모든 851 ID/국가/기준연도/중복 그룹을 판정한다. reasonCounts는 중복 집계다. sourceDigest는 원본의 기존 canonical hash다. 재생성은 API 디렉터리에서 node --import tsx scripts/report-race-playability.ts. DB 접근·import·seed 없음.

현재 원본 전체에 개별 코스 연결과 게임 등록비/상금 승인이 없으며, 검증된 상대마 구성·연간 반복·승수 조건도 없다. 최대두수 미확인 849, 노면 미지원 440, 등급 미지원 624, 연령 미확인 46, 성별 규칙 미지원 334, 출처 verified 아님 182, 일자 미확인 41, 미개최 18, 중복 검토 6행이다. 공식 총상금을 게임 1착상금으로 대체하지 않는다. gameEnabled를 요청값이나 DB payload로 바꿔도 이 판정은 승인되지 않는다.

따라서 수치/성별/코스/상대마를 임의로 창작하지 않는 이번 범위에서는 검증된 subset이 비어 있다. 이 계약을 보고 실제 출전 버튼을 만들지 않는다. 총괄이 선정한 소수 경주의 검증 자료와 게임 밸런스·반복 규칙 승인 후 별도 PR로 immutable 매핑/출전 데이터를 추가해야 한다. migration/Seed 변경이 필요하면 후속 승인 항목이며 이번에는 파일 변경·명령 실행 모두 없다.

## FE 후속

공개 목록/상세는 playability.status와 reasons를 표시하고 sourceRaceId로 일관성을 확인한다. Server에서는 소유 Career를 포함한 기존 race-entries 조회로 다시 확인한다. 현재는 전부 blocked이므로 출전 버튼을 비활성 안내로 표시한다. 기존 개발 경주 진입은 query 없는 API의 eligible·restrictionReason·definition.id를 사용한다. 운영 Server Save 활성화·브라우저 bridge·UI는 이번 Backend 범위 밖이다.

# 2단계 — 버전된 비활성 매핑 기반

기준 develop `ed26067aba1268e955074136f6ea391b5b96ee0c`. 1단계의 blocked 응답, 기존 19개 게임 경주, API/Client/생성 validator를 재작성하지 않는다. **현재 승인된 매핑 0, playable 0 / 851행(공개 848개)**을 유지한다.

## 선언형 매핑과 검증

`packages/shared/src/race-mapping.ts`의 `RaceMapping`은 다음 정보를 명시한다.

- version=1, referenceId와 gameDefinitionId, candidate/verified/approved 상태 및 revision.
- 공식 reference의 원본 sourceDigest와 비교 가능한 중요 사실 snapshot. DB 읽기 응답의 playability는 원본 해시에서 제외한다.
- 정확한 게임 definition snapshot/definitionDigest, courseId/courseSnapshot/courseDigest. 이름·거리의 유사성으로 ID를 연결하지 않는다.
- 연령 min/max, 성별(any만 지원), 승수 min/max, KRW 게임 등록비/1착상금, 기존 상대마 생성 profile과 최대두수.
- referenceYear=2026 자료와 firstGameYear=2028 육성의 seasonMonth를 연결하는 repeat_season_month 정책. 실제 sourceMonth/definition.month와 일치해야 한다.
- identity/duplicate/country/course/surface/distance/grade/age/sex/wins/economy/opponents/calendar **13개 항목별 승인 결정 URL·reviewer·상태**. 단순 `state=approved` 변경으로 가용해지지 않는다.

`services/api/src/modules/racing/mapping.ts`의 `inspectRaceMapping(unknown, reference, course, definition)`이 strict schema, 원본·코스·정의·매핑 SHA-256, 기존 OpenAPI RaceDefinition/Course validator와 공유 규칙을 검사한다. 공유 `validateRaceMapping`은 같은 정확한 snapshot·사실과 승인 요건을 검사하고, `validateMappingRegistry`가 1:1 ID·중복 reference/year context·중복 그룹 충돌을 검사한다. hash는 기존 catalog의 canonical digest를 재사용한다.

공식 총상금은 gamePrizeMoney로 대체하지 않는다. 현재 엔진에서 표현할 수 없는 G1/G2/G3, dirt/sand/synthetic, 성별 제한, 명목 환산 거리, 불명확한 두수/코스는 차단한다. 상태 이름이 verified여도 실제 출전 승인과 같지 않다.

## 후보 보고서

기존 재생성 명령 `node --import tsx scripts/report-race-playability.ts`를 재사용하면 1단계 보고서에 더해 `reports/race-mapping-candidates.json`을 생성한다. 별도 API나 DB importer를 추가하지 않았다.

보고서는 모든 851행의 source ID·원본 URL/중요 사실·원본 hash, null인 게임 정의/수치, 13개 결정 필요 항목, 기존 blocked 이유와 상세 검증 이유를 포함한다. 669개의 source verified 표기는 게임 매핑 승인이 아니다. 필수 원본/게임 값 누락은 851행이며 approvedMapping/playable은 모두 0이다. reasonCounts는 중복 집계다. 기존 19개 DEV 정의에는 공식 reference 연결 증거가 없어 exact match 후보가 0이며 유사 이름/거리 검색을 하지 않는다. 각 기존 정의 hash를 보고서에 남긴다.

후보 목록은 비활성 검토 문서다. `raceMappingRegistry={version:1, activation:'disabled', mappings:[]}`이며 읽기 전용으로 고정돼 있다. 보고서 생성기는 여기에 항목이 추가되면 실제 연결이 승인된 것으로 오인하지 않고 중단한다. 자료 변경 시 source/definition/course/revision hash와 승인 문서를 함께 다시 검토한다.

## Local/Server 경계와 미구현 범위

공유 비동기 `previewMappedEntry`는 Web Crypto로 4개 SHA-256을 다시 확인하며, 검증된 **가상/미래** 매핑의 동일한 snapshot을 바탕으로 기존 `raceOccurrenceForTurn`, `raceEligibility`, `careerProgress`, `canRace`를 재사용한다. 월간 행동/raceRun 잠금, 계약 기수, 실제 자금, 체류국, 현재 월, 나이 조건을 확인하며 3/15/63턴 등 절대 턴을 보존한다. 현재 Local이 지원하지 않는 월은 `live_calendar_not_supported`로 막아 Server만 미리 지원하는 답을 내지 않는다. 반환값은 복제본이며 원본 정의를 바꾸지 않는다.

**이 함수는 출전 승인/등록 명령이 아니다. 현재 authoritative Server 조회/POST 또는 Local 저장 경로에 매핑을 추가하지 않았다.** 모든 실제 출전은 기존 경로만 사용한다. 소유권·은퇴 상태·Server pending 이벤트·명령 receipt·원장 원자성·기수/원정 잠금은 기존 호출자가 계속 검증해야 한다. dry-run을 HTTP 호출의 권한/동시성 검증으로 대체하면 안 된다.

실제 연결 **미구현** 이유: 승인된 완전한 공식 경주/게임 정의/코스/조건/수치/상대마/시즌 반복 조합이 0개이며 신규 DB/Seed 적용이 허용되지 않았다. 다음 승인 이후 별도 활성화 PR에서 아래 항목을 함께 처리해야 한다.

1. 완전한 경주별 증거·13개 기획 결정 및 승인된 immutable mapping revision.
2. 동일 definition ID와 snapshot을 authoritative DB/Local 목록에 도입하는 별도 승인된 이행. 원본 reference 및 오래된 저장/로그는 변경하지 않는다.
3. Server list/detail/options/POST에서 같은 검증·mapping을 사용하고, Local occurrence/eligibility/save 검증에도 동일한 정의와 연령 규칙을 연결한다. 기존 출전 월 외에 확장할 경우 달력·진행/종료·저장 검증을 함께 승인한다.
4. locked snapshot은 최신 매핑으로 재계산하지 않는다. 정의/매핑 revision 보존, 구형 Save/replay, 정산·중복 요청 회귀를 기존 CI에서 확인한다.

## FE #101 인계

공개 API의 `playability.status='blocked'`, `eligible=false`, `raceDefinitionId=null`, `calendarPolicy='not_approved'` 및 기존 reason 코드는 그대로다. 새 API/필드는 없어서 OpenAPI/Client/validator 변경도 없다.

```ts
const detail = await client.getRaceSchedule(referenceId)
// 현재는 모두 blocked: offline candidate/state 또는 source verified만으로 출전 버튼 금지.
const options = await client.getRaceEntryOptions(careerId, { referenceRaceId: detail.id })
// options.referenceRace: 정확한 source ID의 blocked 상태. options.races=[] 유지.
// 기존 19개 게임 경주는 query 없는 API의 실제 definition.id / eligible / restrictionReason 사용.
```

미조회·실패를 0개로 바꾸지 않고, 후속 실제 활성화 계약이 병합된 후에만 source→game 출전 버튼을 연결한다. 이번 후보 JSON/검증 helper를 브라우저가 승인 데이터로 올리는 API는 존재하지 않으며 POST에 mapping을 보내면 기존 strict 요청 schema가 400으로 거부한다.
