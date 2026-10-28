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
