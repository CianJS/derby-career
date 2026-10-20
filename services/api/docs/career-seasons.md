# 육성 시간과 시즌 경주 계약

기본 육성은 60턴이며 1턴은 1개월이다. 60턴은 종료 조건이 아니다. 61턴 이후에도 같은 행동·경주·저장 경로를 사용한다.

## 공통 함수

`packages/shared/src/domain`에서 다음 순수 함수를 Local/Server가 공유한다.

- `careerProgress(turn)` → `{ turn, baseTurns: 60, seasonIndex, seasonTurn, age, extended }`. 턴은 1부터 시작하고, 시즌 차수는 1~12다. 1~12턴은 2세, 13~24턴은 3세, 49~60턴은 6세, 61턴부터는 7세다. `extended`는 61턴부터 true다.
- `nextSeasonRaceTurn(turn, seasonTurns)`는 현재 턴을 포함한 다음 개최 절대 턴을 반환한다. 일정이 비어 있으면 null이다. 예: `(13, [3,6,9,12]) → 15`, `(61, [3,6,9,12]) → 63`.
- `raceOccurrenceForTurn(definition, turn)`은 원본 시즌 차수와 일치하면 `month`를 실제 절대 턴으로 투영하고, 불일치하면 null을 반환한다. 원본 데이터는 변경하지 않는다.
- `racesForTurn(turn)` / `localRacesForTurn(turn)`은 국내/원정 후보를 같은 방식으로 반복한다. `isRaceTurn`, 출전 자격·잠금·검증과 서버 원정 대상 확인도 이 규칙을 따른다.
- `normalizeCareerAge(career)`는 활성 Career의 연령만 동기화한다. 과거 RaceRun·Log·전적 및 은퇴 snapshot에는 적용하지 않는다.

## 저장 및 HTTP 의미

`careerTurnIndex`와 기존 `Career.month`는 말의 누적 절대 턴이다. 마방 `calendarDate`의 연·월과 별개이며, 새 말은 마방 달력이 몇 년도이든 1턴·2세로 시작한다. 연령 증가는 달력의 1월이 아닌 12턴 경계에서 발생한다.

`GET /v1/catalog/races`의 원본 `definition.month`는 시즌 차수다. `GET /v1/careers/{id}/race-entries`의 후보 및 출전 확정 뒤 RaceRun/Snapshot의 `month`는 실제 절대 턴이다. 예를 들어 `DEV_M3_MILE_1600`은 ID를 유지하면서 3·15·27턴에 나타난다. 각 출전은 별도의 Run ID·Seed·결과·원장·신뢰도 변경으로 처리한다. 월 1회 행동 및 완료 멱등성은 그대로 유지한다.

기존 활성 Save는 조회 시 `careerTurnIndex`로 연령만 동기화하며, 정상 명령 저장 때 반영한다. Local 조회 자체는 원본 저장 문서를 덮어쓰지 않는다. 기존 나이 필드와 Save 버전은 유지하며 은퇴 기록·잠긴 입력·Log·금액·계약·신뢰도는 다시 계산하지 않는다. 과거 receipt도 그대로 재생하므로 화면 복원에는 최신 workspace를 사용한다.

DB migration, Seed 변경, 경주 ID 복제 또는 공식 참고 카탈로그의 플레이 활성화는 없다. v1/v2/v3/v4 엔진 계산은 변경하지 않는다.

## Frontend 연결

`careerOutlook(career, { availableFunds?, travel? })`의 새 `progress`를 사용하면 `13/60 · 2년차 1/12 · 3세`를 표시할 수 있다. 60을 초과하면 `progress.extended`로 연장 육성을 표시한다. 기존 `yearMonths`는 12개월 시즌 길이를 유지하는 호환 필드이며 전체 육성 제한으로 사용하지 않는다.

`nextRace.month`는 다음 실제 절대 턴이고 `monthsAway`는 현재 턴과의 차이다. 현재 월에 이미 행동/출전을 확정했다면 다음 개최 차수로 넘어간다. 후보 수는 현재 기록·건강과 전달한 실제 자금·원정 상태를 기준으로 계산하며, 미래 회복·승수·자금·원정 이동을 예측하지 않는다. 자금/원정을 생략하는 기존 호출은 국내 후보와 기존 유료 출전 제한을 유지한다. 실제 Local 상태나 서버 출전 API를 최종 자격 기준으로 사용한다.

후속 FE 작업은 이 PR 병합 후 최신 develop의 공통 계약을 사용한다. 이번 작업에 UI 수정, 강제 은퇴 조건·사망 이벤트 또는 Production 배포는 포함하지 않는다.
