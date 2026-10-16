# 기수 신뢰도 — jockey-trust-v1 / race-sim-v4

말-기수 관계의 사용자 명칭은 **신뢰도**다. 기존 DB `jockey_chemistry.chemistry`와
RaceRun의 `jockeySnapshot.chemistry`는 호환성을 위해 이름을 유지한다. 단위는 모두 정수 0~100이다.
기수 기본 능력, `ridingFit` 추천 점수, 신뢰도는 서로 다른 값이다.

## 저장과 완료 처리

- 신규 말의 신뢰도는 0. Server 관계 키는 `(owned_horse_id, jockey_id)`다.
  Local은 현재 Career의 `jockeyTrust[jockeyId] = { starts, trust }`를 사용한다.
- 기수 교체는 기존 관계를 지우지 않는다. 새 Career는 같은 후보 말을 골라도 별도 관계로 시작한다.
- 완료 시 출전 Snapshot의 신뢰도를 기준으로 0~39는 +15, 40~69는 +10, 70~99는 +5.
  100에서는 증가하지 않는다. 하락 판정이 나면 성장 대신 감소하며 0~100으로 제한한다.
- 1착은 하락하지 않는다. 2착은 일반/유력 0.5%/1%, -2; 3착은 1%/2%, -2;
  4착~상위 절반은 4%/7%, -4; 하위 절반은 8%/12%, -6.
  상위 절반의 마지막 순위는 `ceil(출전 두수 / 2)`이고 2·3착 규칙을 먼저 적용한다.
  출전 신뢰도 70 이상이면 **경주** 감소량만 최대 3이다. 이벤트 감소량에는 이 제한이 없다.
- `trustRaceRoll`은 `jockey-trust-v1:raceRunId:raceSeed:decline`의 별도 결정적 난수다.
  시뮬레이션/이벤트 Director의 난수 스트림을 소비하지 않는다.
- 결과의 `career.state.raceRecords[].trustChange`에 before/after/delta, 판정 근거와 난수를 남긴다.
  저장된 결과·상금·기승 횟수·신뢰도·월 진행·receipt는 같은 owner-locked transaction에 반영한다.
  동일 commandId 재시도 또는 다른 commandId의 중복 완료는 다시 적용하지 않는다.
- 출전 Snapshot과 실제 Log는 출전 확정 후 고정한다. 완료 후 신뢰도는 **다음 출전**부터 사용한다.

## 출전 전 우승 유력 평가

`createTrustContext`는 실제 시뮬레이션 전에 입력 Snapshot만으로 다음을 계산한다.

1. 출전마 전체를 동일한 가상 평가 필드에 넣고 ID를 순서별 평가 ID로 정규화한다.
2. **변경되지 않은 v3**를 `trust-rating-v1:0`, `:1`, `:2`라는 고정 평가 Seed로 실행한다.
   기수 chemistry는 모두 0으로 두어 관계 보정이 전력 평가에 중복 반영되지 않게 한다.
3. 각 말의 `rating = 거리(m) / 평균 완주 시간(s)`을 계산한다.
4. 육성마 rating이 최강 상대 rating의 1.02배 이상일 때 `favorite=true`다.
   2%는 우승 확률 추정치가 아닌, 근소한 차이를 유력으로 분류하지 않기 위한 기준이다.

말의 5대 능력, 거리/잔디/전술 적성, 기수 5대 능력, 피로·부하 및 부상,
상대 전력과 전개는 현행 v3의 계산을 그대로 따른다. 컨디션은 v3와 동일하게 피로·부하로 반영한다.
현재 게임 출전 경주는 Turf fixture에 한정되며 새로운 노면의 출전/계산을 추가하지 않는다.

실제 raceSeed, 결과, 월 완료 이후의 능력/기수 카탈로그를 평가에 사용하지 않는다.
`RaceRun.trustContext`의 version/favorite/playerRating/strongestOpponentRating은 입력과 함께 잠긴다.
평가 중의 결과는 임시 평가치이며 실제 Run/Log/보상으로 저장하거나 선택하지 않는다.
완료/새로고침/재시도에서는 평가를 재실행하지 않는다.

## v4와 구버전 엔진

`race-sim-core.ts`는 기존 v3 본체를 추출한 공유 코어다. v3 wrapper는 보정을 전달하지 않고,
v4 wrapper만 각 runner의 잠긴 신뢰도에 대해 다음 보정을 전달한다.

```text
baseExecution = 기존 v3 execution 계산 및 기존 범위 제한
trustBonus = 0.08 × (trust / 100)
execution = clamp(baseExecution + trustBonus, 기존 min, 기존 max)
```

최고속도·지구력·파워, 원래 기수 능력 및 v3 balance config는 변경하지 않는다.
공유 코어의 난수 방식도 그대로이므로 신뢰도 0인 v4는 엔진 이름을 제외하면 v3와 동일하다.
v1/v2/v3는 chemistry 값이 달라져도 예전과 같은 Log를 산출한다.
기존 v1 golden 432개와 develop `307876b0601e8cd500e98f8ee1a9fe4b81cdf7a9`에서
변경 전에 추출한 v2/v3 golden 144개로 계산 호환성을 검증한다.

신규 Local/Server 출전 기본 엔진은 v4다. 명시적 v1/v2/v3 요청도 지원하고,
기존에 저장된 Run/Log/receipt는 원래 버전 그대로 읽는다. 시청·완료에서 재계산하지 않는다.

## 명시적인 이벤트 효과

서버 카탈로그의 구조화된 선택지/확률 분기 효과:

```json
{ "type": "jockey_trust", "jockeyId": "SEO_JIAN", "amount": 8 }
```

amount는 `5, 8, 12, -5, -8, -12` 중 하나다. 현재 말의 계약 또는 기존 관계 기수만 지정할 수 있다.
실행할 수 없는 대상은 선택/추첨 적격 검사에서 제외한다. 경주 잠금 중에는 적용하지 않는다.
선택 확정 transaction에서 즉시 1회 적용하고 `event.result.trustChanges[]`를 기록한다.
월간 행동을 만들거나 추가 이벤트를 발생시키지 않는다. 기존 위험 선택 확률/월간 Director 규칙은 유지한다.

Local fixture 형식은 `{ scope: 'immediate', trust: { jockeyId: 'SEO_JIAN', amount: 8 } }`이며
동일한 공유 `applyTrustEvent`를 사용한다. Local/Server는 저장/카탈로그 형식만 다르다.
실제 배포 카탈로그 1,000개에는 이번 효과를 추가하지 않았다. 추가된 이벤트는 모두 자동 테스트 전용이다.
후속 콘텐츠 작업에서 명시적 대상·선택지·수치를 검토해 등록해야 한다. 원문 문자열을 실행 중 해석하지 않는다.

## DB migration / 이전 저장

`npm run db:migrate`로 **007_jockey_trust.sql**까지 적용한다. readiness는 007을 요구한다.
기존 001~006은 수정하지 않는다. 007은 엔진 enum/이벤트 효과 enum을 확장하고,
은퇴마 관계의 삽입·변경·삭제 및 관계 ID 변경을 막는다. 관계 테이블의 기존 범위/PK/starts를 유지한다.

기존 결과·Log·관계 행·기승 횟수에 일괄 UPDATE/backfill을 하지 않는다. 기존 DB chemistry는 보존한다.
Local의 새 map이 없으면 jockeyId와 raceRunId가 확인되는 **고유 완료 전적만** starts에 반영하고
신뢰도는 0으로 시작한다. 기수/Run 식별자가 없는 기록에서 관계값을 추정하지 않는다.
이전 완료 전적을 재생해 소급 성장시키지 않으며 신규 완료부터 규칙을 적용한다.
이전부터 잠긴 Run에 trustContext가 없으면 우승 유력을 사후 계산하지 않고 일반 확률을 사용하며
변경 기록에 `rated=false`를 남긴다.

Career version은 1을 유지하고 새 map/context/change는 선택 필드로 추가하여 이전 저장을 읽는다.
새로 은퇴한 Local archive와 Server retirement snapshot에는 최종 map을 보존한다.
이전 immutable retirement snapshot은 수정하지 않는다. 서버의 옛 은퇴 관계는 아래 조회 API로 확인할 수 있다.

## Frontend 계약

| 사용처           | 데이터                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------ |
| 현재 관계        | 기존 Career/Workspace의 `career.state.jockeyTrust[jockeyId]`                               |
| 출전 선택        | 기존 `race-entries.jockeys[].chemistry` (신뢰도 의미)                                      |
| 현역/은퇴 관계   | 신규 `GET /v1/careers/{careerId}/jockey-relations` / `client.getJockeyRelations(careerId)` |
| 출전 당시 값     | `raceRun.player.jockeySnapshot.chemistry`                                                  |
| 출전 전 평가     | `raceRun.trustContext`                                                                     |
| 경주 후 변경     | 완료 응답의 `career.state.raceRecords[].trustChange`                                       |
| 이벤트 변경      | `career.event.result.trustChanges[]`                                                       |
| 새 은퇴 snapshot | `retirement.snapshot.state.jockeyTrust`                                                    |

관계 조회 응답 예시(식별자는 예시):

```json
{
  "careerId": "00000000-0000-4000-8000-000000000001",
  "ownedHorseId": "00000000-0000-4000-8000-000000000002",
  "revision": 7,
  "status": "active",
  "data": [{ "jockeyId": "SEO_JIAN", "starts": 2, "trust": 30 }]
}
```

모든 조회는 현재 인증 정책과 Career 소유권을 적용하고 no-store다. 다른 소유자/없는 ID는 404,
잘못된 UUID는 400, 무인증은 401이며 인증 미설정 기본 모드는 기존대로 503이다.
Next 로컬 저장 bridge에 읽기 경로/생성 응답 검증기를 연결했다. 신뢰도 업로드 API는 없다.

FE는 사용자 명칭을 **신뢰도**로 표시하고 정적 `legacy-catalog.j.chem` 대신 위 관계 데이터를 연결해야 한다.
능력치/기승 적합도와 별도로 표시하고 로딩/오류/미확인 상태를 실제 0으로 바꾸지 않는다.
현재 말과 은퇴마의 Career ID/ownedHorseId를 혼용하지 말고 늦은 응답은 ID/revision으로 걸러야 한다.
명령 receipt는 과거 상태일 수 있으므로 기존 controller처럼 최신 Workspace GET으로 복원한다.
출전 시 API의 defaultEngineVersion을 사용하고 재시도에서는 최초 엔진/본문/UUID를 유지한다.

생성 타입과 strict 응답 검증기가 변경되므로 **기존 FE 번들도 최신 공유 계약으로 다시 빌드**해야 한다.
이번 Backend PR은 레이스/기수 화면을 수정하지 않는다. 별도 FE Work에서 이름 및 화면 데이터 연결이 필요하다.

## 자동 검증

- 성장 경계 0/39/40/69/70/99/100, 모든 순위/유력 여부별 10,000개 난수 구간과 임계값.
- 높은 신뢰도 경주 감소 제한, 이벤트 ±5/8/12와 상하한, 독립 Seed 및 평가 잠금.
- v4 재현성, 신뢰도 0의 v3 동일성, execution 상한, 구버전 golden, Local 저장/은퇴 복원.
- 3거리 × 4전술 × 12 Seed의 상급(전 능력 90, 신뢰도 0)/하급(전 능력 60, 신뢰도 100)
  비교: 각 조합에서 상급 기수 평균 완주 시간이 더 짧아야 한다. 이 표본 기준은 모든 밸런스 조합의 승패 보장이 아니다.
- Server/Local 같은 입력의 관계 변경 일치, 중복 완료/receipt 실패 rollback, 말/기수/소유권 분리.
- 실제 PostgreSQL의 동시 완료/이벤트 선택과 재요청에 starts/신뢰도/상금 1회 적용.
- v4 Playback/adapter 호환, bridge 검증, Month 1~7 서버 저장의 재시도/새로고침 흐름.
