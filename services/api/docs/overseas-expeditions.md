# 해외 원정 서버 계약

## 스키마와 호환성

`008_overseas_expeditions.sql`은 마방의 `home_country/travel_revision`, 게임용 `race_definitions.country_code`, `stable_expeditions`를 추가한다. 기존 마방과 기존 국내 개발용 17개 경주는 KOR다. 그 외 국가 미확인 경주는 null로 남기고 출전을 차단한다. 과거 RaceRun/Log/결과/명령 receipt/은퇴 JSON은 수정하지 않는다.

국가는 ISO alpha-3 문자열이다. 게임은 KOR/JPN/USA를 지원한다. 미지원 GBR 등 기존 국가 값은 조회에서 보존하고, 새 생성·원정/출전에서는 명시적으로 거부한다. Local Save를 읽거나 이관하지 않으며 영국을 한국으로 바꾸지 않는다. `CreateCareer.homeCountry`는 신규 마방에만 적용하는 선택 필드다. 생략하면 신규 마방 KOR, 기존 마방은 기존 국가를 승계한다. 기존 마방에 다른 국가를 지정하면 409다.

`Career.travel`과 `workspace.stable.travel`, `RaceDefinition.countryCode`는 구버전 응답/receipt/저장 로그를 허용하기 위해 선택 필드다. 최신 조회에는 travel이 항상 포함되며 개최 국가가 확인된 게임 경주에는 countryCode가 포함된다. 과거 응답에는 이를 소급 삽입하지 않는다. FE는 응답 유실 뒤 같은 UUID/본문을 재시도하고 최신 workspace를 다시 조회한다.

적용은 기존 `npm run db:migrate`, 개발 fixture 등록은 개발 환경에서만 `npm run db:seed`다. 기존 migration 체크섬과 기존 17개 정의 payload는 보존한다. 새 개발용 `DEV_JPN_M3_MILE_1600`, `DEV_USA_M3_MILE_1600`은 기존 미승리 마일 fixture의 규칙을 재사용한 무료 경주다. 총 게임 fixture 19개이며 공식 참고 원본 851행/목록 848건과 독립적이다. 운영에 자동 Seed하지 않는다.

## 상태와 요청

- 국내: `activeExpedition=null`, `locationCountry=homeCountry`.
- 원정 신청/확정: POST 하나가 검증과 확정을 같은 transaction에서 처리한다. 즉시 active가 되며 별도 승인 확률·대기 월·비용이 없다. 동시에 하나의 국가/원정만 허용한다.
- 현지 출전: 방문 국가의 게임 경주만 가능하다. 국내 경기 또는 제3국 출전에는 먼저 귀국해야 한다. 원정 없이 해외 경주에 출전할 수 없다. 건강·승수·계약 기수·한 달 한 행동·등록비/잔액 검증은 그대로 적용한다.
- 귀국: 현재 원정을 returned로 마감하고 homeCountry로 복귀한다. 확정 경주가 있으면 완료 전 원정 변경/귀국을 409로 거부한다. 출전 전 경주 선택은 출전 API의 최종 확정까지 변경 가능하다.
- 은퇴: 미완료 경주/행동은 기존대로 차단한다. 은퇴가 확정되면 원정도 같은 transaction에서 retirement 사유로 마감한다. 다음 말은 동일 마방 국가/잔액/계약/원장을 승계하고 activeExpedition은 없다. 마감된 원정 기록은 수정/삭제할 수 없다.

여행은 추가 핵심 행동이나 시간을 소모하지 않는다. 이미 완료한 월간 행동/이벤트는 유지하며, 원정 중에도 기존 월간 처리 규칙을 따른다. `travel.revision`은 원정 신청/귀국/원정 중 은퇴에서만 증가한다. 경주 완료로 Career revision/월이 변해도 travel revision은 유지된다.

| API                                                       | 공유 클라이언트                            | 응답                              |
| --------------------------------------------------------- | ------------------------------------------ | --------------------------------- |
| GET `/v1/careers/{id}/expedition`                         | `getExpedition(id)`                        | `{travel}` — 현재 마방 상태       |
| POST `/v1/careers/{id}/expeditions`                       | `startExpedition(id, body)`                | `{career}` — `career.travel` 포함 |
| POST `/v1/careers/{id}/expeditions/{expeditionId}/return` | `returnExpedition(id, expeditionId, body)` | `{career}`                        |

세 API는 기존 Career 소유자 인증이 필요하다. 기본 AUTH_MODE=disabled에서는 공개되지 않는다. 원정 ID만으로 다른 소유자/Career에 접근할 수 없다. 운영 인증/배포 설정은 변경하지 않는다.

```ts
const workspace = await client.getCareerWorkspace()
const career = workspace.career!
const departed = await client.startExpedition(career.id, {
  commandId: crypto.randomUUID(),
  targetCountry: 'JPN',
  expectedTravelRevision: career.travel!.revision,
  // 선택 사항. 현재 월의 실제 일본 게임 정의여야 함.
  raceDefinitionId: 'DEV_JPN_M3_MILE_1600',
})
const expedition = departed.career.travel!.activeExpedition!
const options = await client.getRaceEntryOptions(career.id)
// options.races의 definition.countryCode / eligible / restrictionReason 사용.
// 기존 enterRace → 저장 Log 조회 → completeRace 호출. FE가 돈/월/신뢰도를 중복 계산하지 않음.
await client.returnExpedition(career.id, expedition.id, {
  commandId: crypto.randomUUID(),
  expectedTravelRevision: departed.career.travel!.revision,
})
```

신청의 선택적 raceDefinitionId는 초깃값이다. 실제 출전 성공 시 대상 경주가 잠긴 Run의 경주 ID로 바뀌고 실패 시 함께 rollback한다. 기준 자료의 공식 일정 ID를 넘겨도 게임 정의로 간주하지 않는다.

## 멱등성 · 원자성

기존 `executeCareerCommand`의 owner → Career → stable 잠금/receipt를 사용한다. 같은 commandId/본문은 최초 응답을 재생하고 다른 본문은 409다. 같은 활성 대상의 중복 신청은 원정을 추가 생성하지 않는다. 다른 대상 국가/오래된 revision은 409다. 귀국에는 expeditionId가 필요하므로 옛 귀국 요청이 새로운 원정을 닫을 수 없다. 마감된 원정의 재요청은 추가 상태 변경이 없다.

부분 unique index는 마방당 active 원정 하나를 보장하며 Career/stable 복합 FK로 연결을 검증한다. 원정·대상 경주·Career revision·마감 상태·receipt 및 경주 경제/로그는 기존 transaction에 포함한다. 오류는 전부 rollback한다. 신규 Run Snapshot에는 출전 당시 countryCode를 보존하며, 이후 카탈로그의 국가/상금이 바뀌어도 확정 결과를 재계산하지 않는다.

생성 검증기: `validateStableTravel`, `validateExpeditionResponse`, `validateStartExpedition`, `validateReturnExpedition`. OpenAPI가 기준이며 `npm run contract:generate`로 타입/검증기를 함께 생성한다. Frontend 후속 작업은 이 클라이언트/검증기로 UI·Next bridge·재시도 journal을 연결해야 한다. 이번 작업은 UI, Local Save 원정 및 Next bridge 변경을 포함하지 않는다.
