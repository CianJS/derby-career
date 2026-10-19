# 해외 원정 Local / Server 통합

Issue #49. 기준 develop `408e59b884b8afbe6ba76f7f10aedf75dd598d24`는 경제 #46과 원정 Backend #48을 포함한다.

## 저장과 경계

- 브라우저 저장 키와 version 1을 유지한다. lifecycle.travel은 Backend StableTravel과 같은 읽기 형식이다. 기존 country 문자열 대한민국/일본/미국/영국은 KOR/JPN/USA/GBR로 한 번 이관하며 원문과 자금·원장·Archive·로그를 보존한다. GBR 및 미지원 국가는 표시/보존하고 신규 육성·출전·원정을 차단한다. 손상된 원정 데이터는 덮어쓰지 않는다.
- Local 신청/귀국은 careerStore의 기존 Web Lock 안에서 최신 육성 ID와 travel revision을 검사하고 동일 문서에 저장한다. 원정은 추가 비용/시간/행동을 소비하지 않는다. 완료 전 귀국을 차단한다. 실제 출전 시 국가를 다시 검사하고 활성 원정의 대상 경주를 같은 정산 쓰기에 보존한다. 은퇴는 원정을 종료하고 다음 육성마는 기존 마방 국가·잔액·원장·계약을 이어받는다.
- presentation 저장은 최신 마방 국가/원정/잔액/원장/Archive를 보존하여 오래된 탭의 metadata로 되돌리지 않는다. 최초 마방 등록에서만 국가를 선택한다.
- Local 전용 개발 경주 2개는 Backend의 일본/미국 미승리 마일과 동등하며 기존 국내 17개 seed 및 공식 참고 카탈로그 원본 851/조회 848은 변경하지 않는다. 공유 eligibility의 선택적 travel 인자는 Local 호출에서만 사용한다. Backend는 기존 서버 검증과 정산을 유지한다. 기존 Snapshot은 countryCode가 없어도 재생할 수 있다.
- Server는 workspace.stable.travel, race-entries의 국가/eligible/restrictionReason과 최신 Career만 표시한다. 신규 마방만 homeCountry를 전달한다. 기존 마방의 국가는 덮어쓰지 않는다. 최초 조회와 원정 명령 후 getExpedition을 대조한다. 매 월간 명령에 추가 조회하지 않는다.
- SaveCommand에 expedition-start/expedition-return envelope를 추가하고 공유 요청 검증기를 사용한다. 원래 UUID/본문을 session CommandJournal에 기록하여 응답 유실 후 동일 요청을 복구한다. receipt 뒤에는 최신 workspace를 다시 읽는다. Local 원정이나 경제 계산으로 Server 상태를 확정하지 않는다.
- Next bridge는 기존 development + loopback + 동일 Origin + 서버 전용 인증을 유지한다. 원정 GET/신청/UUID별 귀국 경로만 허용한다. Production에서 비활성화되며 외부 인증/배포 설정은 변경하지 않는다.

## 화면과 검증

육성·출전에서 소속/체류 국가, 대상 원정 경주, 신청/귀국, 확정 경주 중 차단, pending/error를 표시한다. 마구간·설정은 국가/원정 상태를 조회한다. 홈은 기존 Game Lobby를 유지한다. 신규 Server 마방 국가 선택은 말 선택 화면에 있다.

- local-travel.test: 두 국가 원정/실제 로그와 상금/귀국, 저장 실패, revision/다중 명령, 은퇴 승계, legacy 4개국과 손상 상태.
- overseas-expedition.integration: 실제 Fastify fixture + Next bridge + SDK + Controller + Journal. 양국 원정, 응답 유실 동일 명령 재시도, 409, 국내 직접 출전 거부, 외국 출전, 잠긴 귀국 차단, 결과 잔액, 귀국.
- overseas-expedition.spec: Local/Server 각 일본·미국 흐름을 390px light/1440px dark에서 실제 UI와 HTTP로 검사한다. Local 두 탭 동시 신청, 월 3 해외 경기/로그/결과, 귀국, 월 6 국내 경기, 금액/기록/가로 넘침, 서버 응답 유실 동일 UUID 재시도와 Local 문서 미생성 포함.
- 기존 경제·신뢰도·은퇴·월간 행동·카탈로그·v1–v4 관전 회귀를 함께 실행한다. 서버는 기존 독립 PostgreSQL 17 CI 환경의 migration 008과 개발 fixture를 사용한다. Production DB 및 배포는 사용하지 않는다.

최종 실행 수와 CI/스크린샷 증거는 PR의 검증 기록을 따른다. 실제 모바일 기기 및 Chromium 이외 브라우저 검증은 포함하지 않는다.
