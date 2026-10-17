# Local / Server 마방 경제 UI

Issue #45, Backend PR #44의 기존 경제 계약을 사용한다. Backend API·DB·OpenAPI·generated 및 레이스 v1~v4 계산은 변경하지 않는다. 실제 경주 카탈로그를 출전 후보로 활성화하지 않는다.

## Local Save

기존 `derby-career-browser-save-v1` 문서와 version 1을 유지하고 lifecycle에 선택적 필드를 추가한다.

```ts
fundsKRW: number // 0..Number.MAX_SAFE_INTEGER의 정수
// raceRunId + kind는 문서 전체에서 고유하다. 무료/무상금도 0원 내역을 남긴다.
economyLedger: {
  raceRunId: string
  kind: 'entry_fee' | 'prize'
  amount: number
}
;[]
```

신규 마방은 20,000,000원이다. 기존 저장의 숫자 `fundsKRW`가 우선이며, 아직 없으면 정상 형식의 legacy `funds`(예: `₩42,800,000`)를 한 번만 숫자로 이전한다. 빈 값/미기록이면 초기 자금을 한 번 저장한다. 이전 이후 표시 문자열은 금액 계산에 사용하지 않는다. 기존 완료 경주·은퇴 기록을 역산해 등록비/상금을 소급 반영하지 않는다. 잘못된 금액, 안전정수 초과, 원장의 타입·부호·중복 손상은 원본을 유지하고 오류로 표시한다.

- 기존 Web Lock 안에서 최신 저장 ID·월을 재검사한다. 다른 탭이 새 말을 시작한 경우 복구나 정산 전에 거부한다.
- 출전: 공유 `lockRaceEntryWithLog`에 권위 있는 잔액을 전달해 기존 승수·월·건강·계약과 등록비 조건을 검사한다. 가격을 다시 만들지 않는다. 로그를 먼저 보존하고, RaceRun 잠금·등록비 차감·entry_fee·육성마 표시 snapshot을 한 번의 `writeBrowserSave`로 저장한다. 실패 시 다른 로그를 미리 정리하지 않는다.
- 완료: 저장된 로그를 기존 검증기로 검증하고 그 로그의 placing/prizeMoney를 공유 `completeRace`에 전달한다. 전적·누적 상금·신뢰도·다음 달·prize·잔액·육성마 snapshot은 한 문서 쓰기로 확정한다. 잔액/누적 상금 상한 실패도 전부 원복한다. 로그 정리는 커밋 성공 뒤에만 한다.
- 같은 잠긴 Run의 출전 재시도, 이미 완료된 Run의 완료 재시도에는 새 원장이나 지급을 만들지 않는다. 서로 다른 새 명령이 같은 달에 경합해도 최신 잠금을 재사용한다.
- presentation lifecycle 쓰기는 최신 숫자 잔액·원장·Archive를 보존하므로 오래된 UI metadata가 정산을 덮지 못한다. 은퇴 및 새 말 선택은 같은 마방의 잔액/원장을 이어받고 말의 전적·신뢰도는 기존 정책대로 보존/초기화한다.

공유 출전 도우미에 추가한 잔액 인자는 선택적이다. 인자를 생략한 기존 호출은 종전의 유료 출전 제한을 유지하며 엔진 계산이나 Backend의 가격 검증을 대체하지 않는다.

## Server Save

잔액은 최신 `workspace.stable.funds`, 제한은 서버 `race-entries`의 eligible/restrictionReason, 완료 내역은 서버가 저장한 raceRecords/prizeMoney다. Local 정산 함수를 호출하지 않는다. 기존 Journal의 요청 UUID/본문을 유지한 재확인과 최신 Workspace 조회를 사용한다. 서버가 처리한 등록비/상금/월 진행을 다시 적용하지 않는다.

기존 저장 모드가 바뀌는 동안에는 이전 모드의 잔액·Career를 표시하거나 새 모드로 복사하지 않는다. 최초 조회/마이그레이션도 Root가 선택한 저장 모드를 설정한 뒤 수행한다.

## 기존 화면

상단·마구간에서 실제 마방 잔액을 표시한다. 단일 출전 Workspace의 기존 가격/1착 상금과 잔액·부족 사유를 연결하며, 수동 선택은 잔액이 바뀌었다고 초기화하지 않는다. 불가해진 선택의 확정은 잠근다. 결과 화면은 지급 전과 저장된 지급 완료를 구분하고 실제 현재 잔액을 표시한다. Home Lobby에 별도 경제 대시보드를 추가하지 않는다.

## 검증

- `tests/local-economy.test.ts`: 초기화/legacy 이전, 과거 경주 비소급, 손상 금액/원장, 한 달 중복·동시 명령, 저장 실패/재시도, 로그 보존, 금액 상한, 은퇴 및 새 말 승계.
- 기존 app-routing/browser-save/신뢰도/추천/관전/은퇴 테스트를 유지한다.
- `tests/e2e/economy.spec.ts`: 실제 Chromium 390px/1440px, 서로 다른 두 탭의 유료 출전 경합, reload, 완료 저장 실패/재시도, 지급/잔액/은퇴·차기 육성, 무료 0원·승수·부상·손상 저장 UI. 기존 스타일의 light/dark를 사용한다.
- 기존 실제 서버 브라우저 흐름에 등록비/상금/서버 잔액 일치, 응답 유실 후 재시도, 중복 완료, 은퇴 및 새 말 승계를 추가한다. `prepare-browser-e2e.mjs`는 이름이 `_test`로 끝나는 격리 DB에만 Month 3 스프린트의 500,000원 등록비/2두 조건을 설정해 실제 서버 정산과 양수 상금을 검증한다. 원본 seed/서비스 코드/운영 DB는 변경하지 않는다.

실행 결과 숫자, CI 및 Chromium 증거 링크는 PR의 최종 검증 기록을 따른다. Vercel Preview나 main 배포는 검증에 사용하지 않는다.
