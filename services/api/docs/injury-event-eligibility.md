# 부상 중 월초 이벤트 선택 기준 (UX-12 A)

저장·OpenAPI 형식과 카탈로그 원본은 변경하지 않는다. `canTrain`이 기준이며 정상만 훈련 가능하다. 경상·중등도·중상과 과거 건강 별칭에서도 훈련은 불가능하다. 경주 출전 기준과는 다르다.

## 공유 판단 함수와 FE 연동

- Local: `packages/shared/src/domain`의 `localEventChoiceAvailability(definition, choiceId, career)`.
- Server: `packages/shared/src/event-availability`의 `serverEventChoiceAvailability(definition, choice, { career, choice? })`. 첫 `choice`는 이벤트 선택지, context의 `choice`는 실제 월간 행동이다. 결과 이벤트에서는 저장된 action의 trainingType 또는 rest/treatment를 전달한다. 소유자 Career에 포함된 `event.definition`을 사용하며 공개 카탈로그의 최신 정의로 바꾸지 않는다.
- 공통 반환: `{ available, reason }`. reason은 `training_unavailable`, `action_unavailable`, `conditions_not_met`, `invalid_choice`, `invalid_result`, `trust_unavailable` 또는 null이다. 이 값은 순수 함수 결과이며 HTTP 응답에 새 필드를 추가하지 않는다.
- FE는 저장 이벤트의 상태/현재 턴도 확인한다. 이미 확정·만료된 선택을 다시 활성화하지 않는다. Local 선택 명령은 현재 월과 행동 잠금을, Server는 현재 턴·저장 Snapshot·조건·효과를 다시 검사한다. 불가능한 새 Server 선택은 기존 `422 INVALID_CHOICE`를 반환하며 상태를 바꾸지 않는다.

Local의 기본 조건과 선택지의 공통/특화 훈련 scope를 모두 검사한다. Server는 이벤트·선택지 조건과 실제 효과, 위험 선택의 모든 결과 분기를 검사한다. `resolved_growth_bonus`는 저장된 동일 훈련의 확정 결과가 있어야 실행 가능하다. 한 위험 결과 분기가 훈련 전용이면 부상 중 해당 선택은 불가능하며 결과를 먼저 추첨하지 않는다. 명시적인 무효과 선택/위험 실패 분기는 그대로 허용한다.

즉시 효과, 휴식 효과, 부상 중 치료 효과가 있는 선택은 유지한다. 같은 선택지에 즉시 효과와 훈련 modifier가 섞여 있으면 즉시 효과를 선택할 수 있고, 실행하지 않은 훈련 modifier는 행동/월 종료에 기존 규칙으로 만료된다. 다른 실행 가능한 선택지가 있는 이벤트는 추첨 후보에 남는다. 자동 이벤트는 실제 자동 적용하는 첫 선택지를 검사한다.

Server는 `createMonth`에서 pool을 저장하고 `planDraw`를 실행하기 전에 월초 후보를 필터링한다. `drawEvent`와 선택 명령이 같은 공유 함수를 사용한다. 빈 후보에는 대체 이벤트를 생성하지 않는다. Seed 라벨, 발생률, 카테고리/이벤트 가중치, 보장 기준과 월 최대 1개 규칙은 유지한다. 적격 후보가 바뀌는 부상 상태의 새 추첨 결과는 달라질 수 있다.

## 기존 저장 이벤트

읽기/복원 시 재추첨·삭제·숨김·Seed 변경을 하지 않는다. 이미 선택한 효과/과거 로그도 소급 수정하지 않는다.

Local의 이미 제시된 훈련 전용 선택은 거부하되 휴식·치료를 그대로 허용한다. 실행 불가능한 훈련 효과를 적용하지 않고 기존 월말 만료와 eventLog 기록을 사용한다. 월초 이벤트가 있던 달에 결과 이벤트를 대신 생성하지 않는다.

Server에서 예전 Snapshot의 pending 월초 이벤트가 부상 때문에 모든 선택이 `training_unavailable`이면, 휴식·치료 확정 트랜잭션 안에서 해당 이벤트를 `expired`로 바꾸고 행동을 처리한다. choice_id는 null로 남고 효과는 적용하지 않는다. Snapshot/revision/draw seed/pool/misses와 기존 결과는 보존한다. 읽기만 하거나 선택 요청을 거부할 때는 만료시키지 않는다. 명령 실패는 만료와 행동을 함께 rollback하며 동일 요청의 응답 유실·재시도는 기존 receipt로 복구한다. 만료된 이벤트가 그 달의 이벤트로 남으므로 추가 이벤트도 발생하지 않는다. 실행 가능한 선택이 하나라도 있거나 부상 외 사유로 막힌 이벤트에는 이 우회를 적용하지 않는다.

Frontend Issue #82에서 선택 불가 안내와 휴식·치료 경로를 연결한다. 이번 PR에는 화면 변경이 없다.

## DB 적용

`npm run db:migrate`로 `009_unselected_event_expiry.sql`을 먼저 적용한다. 기존 CHECK가 pending에서 벗어나려면 반드시 choice_id를 요구하여, 플레이어가 선택하지 않은 이벤트를 expired로 저장할 수 없었다. 이 장애 해소에 필요한 최소 예외로 CHECK만 완화한다. pending은 null, selected/applied는 실제 선택 ID를 계속 요구하며 expired만 null을 허용한다. 기존 행을 변경하는 UPDATE/DELETE는 없고 FK·Snapshot/Seed 불변 trigger·월별 UNIQUE도 유지한다. 기존 001~008 파일은 수정하지 않는다. readiness는 009 미적용 시 503을 반환한다. 운영 DB에는 이 작업에서 적용하지 않는다.
