# 초기 기수 계약

신규 마방은 초기 후보 중 직접 선택한 한 명만 무료 계약한다. 기존 마방의 계약은 은퇴·다음 육성마 생성에서도 그대로 유지한다. 추가 영입·해지·비용은 구현하지 않는다. DB migration이나 운영 적용은 없다.

## 공통 도감과 선택

`packages/shared/src/domain`의 `jockeyCatalog`는 기존 ID·능력치 그대로인 전체 6명이다. `starterJockeyOptions`는 `{ jockeyId, specialty }` 4개이며, `StarterJockeyId`, `StarterJockeyOption`, `JockeyContracts`, `CareerJockeySelection` 타입을 제공한다. 특화 표시는 모든 전술의 사용을 허용하는 기존 적합도/레이스 v4 계산을 바꾸지 않는다.

후보는 HAN_DOYUN(도주), PARK_SEOYUN(선행), CHOI_MINJAE(선입), KANG_HAJUN(추입)이다. SEO_JIAN·YOON_TAESUNG도 전체 도감과 기존 저장에서 유지한다. `contractedJockeys`/`freeAgentJockeys`는 이전 소비자·과거 엔진 fixture의 호환용 부분 목록으로만 남기며, 실제 계약 판단에 사용하지 않는다. 실제 Local 명단은 `Career.contractedJockeyIds`/`contractedRoster`, Server 명단은 API의 저장된 계약을 사용한다.

## Frontend 연동

UI는 마방 등록 → 초기 기수 선택 → 육성마 선택 순서로 선택값을 수집한다. 화면 추가/Mock 카드·만료일·기승 기록 제거는 후속 Frontend 작업이다.

- `GET /v1/catalog/jockeys`: 기존 `data`와 선택 후보 `starterOptions`를 함께 반환한다. `createApiClient().listJockeys()` 및 생성 `validateJockeyCatalog`를 사용한다. 후보 목록은 실제 계약 목록이 아니다.
- `POST /v1/careers`: 첫 마방이면 `{ careerId, horseDefinitionId, starterJockeyId, homeCountry? }`. `starterJockeyId`는 네 후보 ID만 허용한다. 이후 Career에는 생략하고 기존 계약을 승계한다.
- 새 마방의 선택 누락은 422 `STARTER_JOCKEY_REQUIRED`, 후보 외 ID/추가 계약 명단 필드는 400, 기존 계약을 바꾸려는 선택은 409다. 후보 DB 정의가 없으면 503 `JOCKEY_CATALOG_UNAVAILABLE`로 전체 롤백한다. 임의 기본 기수로 대체하지 않는다.
- 재시도 시 같은 careerId/본문을 유지한다. 소유자 잠금 안에서 stable·계약 한 행·말·신뢰도·Career·receipt를 함께 저장한다. 다른 기수로 같은 요청을 재사용할 수 없다.
- `GET /v1/careers/workspace`의 `stable.contractedJockeyIds`는 은퇴 후 활성 Career가 없어도 실제 계약을 제공한다. 이전 서버 응답에는 없을 수 있어 optional이다. Career/출전 후보도 `jockey_contracts`를 기준으로 복원한다.
- 현재/은퇴마의 기존 신뢰도 조회 API와 전적·저장 로그는 유지한다. 같은 마방의 다음 말은 계약만 승계하며 새 `(horseId,jockeyId)` 관계는 0에서 시작한다.

Local은 `careerStore.select(horseId, homeCountry?, starterJockeyId?)`로 선택을 전달한다. 첫 선택은 Career와 `LifecycleSave.contractedJockeyIds`를 기존 Web Lock/단일 문서 쓰기로 함께 확정한다. 저장 실패 시 둘 다 이전 상태이며 같은 선택으로 재시도한다. 이후에는 저장된 계약을 우선하고 선택을 생략한다. 기존의 빈 계약도 임의로 채우지 않는다.

순수 `startCareer(horseId, selection?)`/`startServerCareer`는 `{ starterJockeyId }` 또는 `{ contractedJockeyIds }`를 받는다. 선택 없는 순수 모델은 빈 명단을 반환하며 기수를 자동 지급하지 않는다. 실제 신규 시작 경로인 `startLocalCareer`와 Backend 최초 생성은 선택 누락을 거부한다. 기존 Save를 읽을 때는 필드를 덮어쓰거나 새 선택을 요구하지 않는다.

## 범위와 호환성

CreateCareer의 starter 필드는 기존 마방 요청의 호환성을 위해 스키마상 optional이며, 최초 마방 생성에서만 필수다. 기존 Frontend가 새 마방을 선택값 없이 생성하면 오류가 표시되므로 후속 UI 연결 전 자동 선택으로 우회하지 않는다. 기존 저장 버전·브라우저 키·v1/v2/v3/v4 엔진·신뢰도 규칙은 바꾸지 않는다. Source-kind 개발용 DB 카탈로그 분류와 실제 마방 계약 여부는 별개다. 운영 Server Save는 계속 비활성이며 로그인·Production 설정/DB를 변경하지 않는다.
