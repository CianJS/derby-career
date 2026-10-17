# 서버 마방 경제 정산

기존 API/응답 필드를 유지한다. 마방 신규 생성 시 기존 DB 기본값 20,000,000원을 사용한다. 재접속·은퇴·새 Career 생성은 기존 마방 잔액·원장을 초기화하지 않는다. 새 migration이나 과거 기록의 역산/보정은 없다.

- `GET /v1/careers/{id}/race-entries`: 기존 `career.funds`와 경주별 `eligible/restrictionReason` 사용. 소유자 범위의 동일 읽기 snapshot에서 승수·건강·월간 행동·계약 및 DB 잔액을 확인한다.
- `POST /v1/careers/{id}/race-entries`: 기존 본문/`raceRunId` 사용. 클라이언트 금액은 받지 않는다. 서버가 다시 검사한 DB `entryFee`를 Snapshot에 잠그고, 등록비·Run·Log·행동·receipt를 한 transaction으로 확정한다. 성공 응답 `career.funds`는 차감 후 금액이다.
- `POST /v1/careers/{id}/race-runs/{runId}/complete`: 기존 `{commandId}` 사용. 저장된 확정 Log의 `result.prizeMoney`만 상금으로 지급한다. 성공 응답 `result` 및 `career.funds/state.raceRecords`를 사용한다. 상금·전적·건강·신뢰도·월 진행·receipt는 같은 transaction이다.
- `GET /v1/careers/workspace`: 재접속/과거 receipt 재생 뒤 현재 마방 잔액 확인에 사용한다. 은퇴 당시 금액은 기존 retirement snapshot을 사용한다.

원장 `entry_fee.amount`는 음수(무료 0원), `prize.amount`는 양수 또는 0이다. 신규 무료 출전도 0원 원장을 남긴다. 과거 무료 출전의 원장 부재를 오류로 취급하거나 소급 생성하지 않는다. 기존 `UNIQUE(race_run_id, kind)`와 원장 수정/삭제 금지를 유지한다.

소유자 → Career → 마방 잠금 순서와 기존 명령 멱등성을 사용한다. 같은 출전 ID/본문은 최초 receipt를 재생하며 다른 ID로 같은 월에 출전하면 409다. 완료는 같은 ID 또는 다른 ID로 재시도해도 지급/신뢰도/월 진행을 반복하지 않는다. 원장 INSERT 충돌이나 뒤쪽 DB 오류는 잔액 변경을 포함해 전부 rollback한다.

금액은 0부터 `Number.MAX_SAFE_INTEGER`까지 정수만 허용한다. 음수·소수·문자열·null·범위 초과 DB 정의/확정 상금은 500 `INVALID_SETTLEMENT_AMOUNT`, 등록비 부족은 422 `RACE_RESTRICTED`, 잔액/말 누적 상금 상한 초과는 422 `ECONOMY_LIMIT`다. 실패 시 출전/완료 상태와 receipt를 남기지 않는다. 사용자는 잔액 문제를 해결한 뒤 동일 요청으로 다시 시도할 수 있다.

공유 `raceEligibility`의 선택적 세 번째 인자는 서버 DB 잔액이다. 이를 생략하는 Local Save는 기존 유료 출전 차단을 유지한다. 화면·브라우저 자금 처리·실존 경주 활성화·레이스 엔진·신뢰도 계산은 변경하지 않는다.

`tests/economy-cases.ts`의 같은 HTTP/SQL 시나리오를 PGlite와 `test:postgres` 다중 연결에서 실행한다. 테스트 전용 경주 정의는 복원하며 오류 주입 trigger는 제거한다. 실제 DB/Production에는 실행하지 않는다.
