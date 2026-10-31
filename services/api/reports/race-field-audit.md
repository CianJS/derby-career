# 경주 851행 필드 감사·교정 대기표

기준: 보존된 원본 스냅샷 2026-10-15, 원본 SHA-256 `d24e6689dc82a0927bbd6d2e5d2e2b4ff7a2a47d634606720f2aaa126dc32661`. 재생성: `cd services/api && node --import tsx scripts/audit-race-fields.ts`.

**이 감사는 저장소 자료의 필드 재고 조사다. 851개 경주를 외부 원문으로 전수 검증하지 않았다.** 851행 세부 원값·상태·출처와 보정 대기는 [race-field-audit.json](race-field-audit.json)에 있다. 원본 스냅샷을 변경하지 않는다.

- 전체 851행: 한국 51, 일본 176, 미국 624; 기존 공개 distinct 848건. ID와 중복 관계는 기존 기준을 유지한다.
- 원본에 기록된 **행 단위** 검토 상태: 공식 확인 669, 부분 확인 180, 재검토 2. 각 필드를 독립 확인했다는 뜻은 아니다.
- 우선순위: P0 삿포로 파일럿 1행, P1 기존 중복·출처·날짜 확인 필요 185행, P2 나머지 665행. P2가 정확하다는 뜻은 아니다.
- 삿포로 보정 계층 sapporo-2026-source-correction-v1: 1행 13개 근거 항목. 이 감사 자체가 추가로 외부 확인한 필드는 0개다. 실제 승인 registry는 비어 있어 playable 0/851이다.

## 필드 상태와 게임 지원은 별개

원본에 값이 있으면 `수집됨·개별검증대기`, 없거나 구조화되지 않았으면 `누락`으로 표시한다. 원본의 행 단위 공식 확인을 필드별 확인으로 바꾸지 않는다. 출처 충돌은 필드별 증거가 확보된 경우에만 판정한다. 별도 삿포로 보정은 각 항목의 `verificationStatus`, URL·페이지·적용연도·증거 범위를 보존한다.

기존 `race-playability.json`의 게임 차단 사유는 참고 당시의 엔진/매핑 상태이며 사실값 오류가 아니다. 중복 집계이며 현재 PR의 G3 지원 상태와 동일하다고 가정하지 않는다. 게임 조정·엔진 미지원 여부는 원본 사실 상태와 별도로 결정한다.

| 원본 스냅샷 필드 | 구조화된 값 또는 명시적 메모 | 스냅샷에 부재/미구조화 |
| --- | ---: | ---: |
| 개최일 | 810 | 41 |
| 원문 거리·단위 (명시된 메모 추출) | 622 | 229 |
| 직접 경마장 ID | 229 | 622 |
| 경마장 관계값 | 851 | 0 |
| 최대 출전두수 | 2 | 849 |
| 기록된 공식 상금액 | 669 | 182 |
| 1착 금액으로 기록된 상금 | 130 | 721 |
| 총상금으로 기록된 금액 | 539 | 312 |

원문 거리·단위는 명시된 메모에서만 추출했다. 직접 경마장 ID가 비어 있어도 관계값은 있을 수 있다. 기존 정규화는 courseId를 null로 고정하므로 코스 미연결 851건을 원문 부재 851건으로 해석하면 안 된다. 공식 총상금 539건은 1착 상금으로 바꾸지 않는다. 누락은 무료·0·무제한을 뜻하지 않는다.

## 삿포로 2026 보정 사실

sourceId: `RACE_JPN_2026_JRA_075`; 확인일: 2026-10-31. 상세는 보정 계층과 JSON의 `sourceCorrections`를 따른다.

| 필드 | 보정값 | 근거 범위 | 출처 |
| --- | --- | --- | --- |
| 회전 방향 | 우회전 | 공식 경주 일정에 기재된 방향 | [JRA 근거](https://japanracing.jp/en/racing/schedule/graded/list/2026/0905sapporo-nisai.html) · 경주 상세 |
| 계획된 잔디 코스 | C코스 | 시행계획; 당일 변경 여부 미확인 | [JRA 근거](https://www.jra.go.jp/keiba/program/2026/pdf/bangumi/sapporo2.pdf) · 시행계획 1쪽 |
| 공식 최대 출전두수 | 14두 | 정원이며 실제 인원과 별개 | [JRA 근거](https://japanracing.jp/en/racing/schedule/graded/list/2026/0905sapporo-nisai.html) · 경주 상세 |
| 2026년 실제 출전두수 | 9두 | 해당 회차 결과; 향후 기본 인원 아님 | [JRA 근거](https://www.jra.go.jp/datafile/seiseki/replay/2026/080.html) · 공식 결과 착순 1~9 |
| 중앙마 특별등록료 1단계 | 10,000엔 | 중앙마 일정; 자격별 조건 별도 | [JRA 근거](https://www.jra.go.jp/keiba/program/2026/pdf/bangumi/sapporo2.pdf) · 시행계획 2쪽 |
| 중앙마 특별등록료 2단계 | 40,000엔 | 중앙마 일정; 자격별 조건 별도 | [JRA 근거](https://www.jra.go.jp/keiba/program/2026/pdf/bangumi/sapporo2.pdf) · 시행계획 2쪽 |
| 해외마 납부액 | 50,000엔 | 해외 일정; 모든 소속의 단일 단계 아님 | [JRA 근거](https://japanracing.jp/en/racing/schedule/graded/list/2026/0905sapporo-nisai.html) · 국제 일정 8월 28일 납부 |
| 1착 본상금 | 34,000,000엔 | 1착 본상금 | [JRA 근거](https://www.jra.go.jp/keiba/program/2026/pdf/bangumi/sapporo2.pdf) · 시행계획 1쪽 제11경주 |
| 2착 본상금 | 14,000,000엔 | 2착 본상금 | [JRA 근거](https://www.jra.go.jp/keiba/program/2026/pdf/bangumi/sapporo2.pdf) · 시행계획 1쪽 제11경주 |
| 3착 본상금 | 8,500,000엔 | 3착 본상금 | [JRA 근거](https://www.jra.go.jp/keiba/program/2026/pdf/bangumi/sapporo2.pdf) · 시행계획 1쪽 제11경주 |
| 4착 본상금 | 5,100,000엔 | 4착 본상금 | [JRA 근거](https://www.jra.go.jp/keiba/program/2026/pdf/bangumi/sapporo2.pdf) · 시행계획 1쪽 제11경주 |
| 5착 본상금 | 3,400,000엔 | 5착 본상금 | [JRA 근거](https://www.jra.go.jp/keiba/program/2026/pdf/bangumi/sapporo2.pdf) · 시행계획 1쪽 제11경주 |
| 국제 일정 기준 부담중량 | 55kg | 기준 중량; 감량과 소속별 조건 별도 | [JRA 근거](https://japanracing.jp/en/racing/schedule/graded/list/2026/0905sapporo-nisai.html) · 국제 일정 중량 항목 |

최대 14두와 실제 2026년 결과 9두는 별개다. 9두를 미래 게임의 기본 출전 수로 정하지 않는다. C코스는 시행계획이며 당일 변경 여부는 별도 확인이 필요하다. 등록료의 중앙마 단계와 해외마 납부 일정을 혼동하지 않는다. 1~5착은 본상금이며 총상금·부가상금·수득상금과 게임 보상은 별개다.

JRA·NAR·해외마의 상세 신청 자격과 초과 신청 시 선발은 별도 확인·정책 결정이 필요하다. 게임 통화환산율·공통 축소계수·반올림은 미확정이다. Notion 삿포로 1행은 보정 v1과 공식 최대 14두·실제 9두를 동기화하고 재조회했다. 나머지 850행은 이번 지시에 따른 개별 외부 조사·보정 전이다.
