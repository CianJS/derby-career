# 삿포로 2세 스테이크스: 2026 공식 사실 보정 제안

대상은 `RACE_JPN_2026_JRA_075` 한 건이다. `packages/shared/src/sapporo-official-facts.ts`는 2026-10-31에 확인한 근거별 보정 자료이며 기존 원본이나 source digest를 덮어쓰지 않는다. 이 자료 자체는 경기 활성화나 게임 매핑 승인이 아니다.

## 사실과 출처

| 항목               | 2026년 공식 자료에서 확인한 내용                                      | 근거                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 개최 예정          | 9월 5일, 삿포로, G3, 2세, 우회전 잔디 1,800m                          | [국제 경주 상세](https://japanracing.jp/en/racing/schedule/graded/list/2026/0905sapporo-nisai.html)                                                                                    |
| 예정 코스          | 제2회 삿포로 제5일은 뒤 2일에 속하므로 C코스 계획                     | [시행계획 PDF 1쪽](https://www.jra.go.jp/keiba/program/2026/pdf/bangumi/sapporo2.pdf#page=1), 일자 표 및 코스 주석                                                                     |
| 정원               | 최대 14두                                                             | [국제 경주 상세](https://japanracing.jp/en/racing/schedule/graded/list/2026/0905sapporo-nisai.html)                                                                                    |
| 착순별 본상금      | 1~5착 34,000,000 / 14,000,000 / 8,500,000 / 5,100,000 / 3,400,000 JPY | [시행계획 PDF 1쪽](https://www.jra.go.jp/keiba/program/2026/pdf/bangumi/sapporo2.pdf#page=1), 5일 11경주 표. 표기 단위 천 엔                                                           |
| 특별등록료         | 제1·제2 단계 10,000 + 40,000 JPY                                      | [시행계획 PDF 2쪽](https://www.jra.go.jp/keiba/program/2026/pdf/bangumi/sapporo2.pdf#page=2)                                                                                           |
| 해외 일정의 납부금 | 2026-08-28, 50,000 JPY                                                | [국제 경주 상세](https://japanracing.jp/en/racing/schedule/graded/list/2026/0905sapporo-nisai.html), 국제 신청 일정. 중앙마의 단계별 등록료와 납부 절차를 같은 항목으로 뭉개지 않는다. |
| 부담중량           | 국제 경주 상세에 2세 55kg, 남반구 2024년생 3kg 감량 표시              | [국제 경주 상세](https://japanracing.jp/en/racing/schedule/graded/list/2026/0905sapporo-nisai.html). 대상별 적용은 별도 규칙 확인 필요.                                                |

C코스는 공식 **시행계획**의 사실이다. [JRA 실제 결과](https://www.jra.go.jp/datafile/seiseki/replay/2026/080.html)에서 2026년 1~9착의 실제 출전 9두를 확인했지만 당일 레일 변경 여부는 확인하지 않았다. 최대 14두, 실제 9두와 미래 게임 명단은 서로 다른 값이다. 총액 74,180,000 JPY는 국제 경주 상세에서 별도로 표기한 총액이며 착순별 본상금, 부가상금, 수득상금 또는 게임 보상을 서로 대체하지 않는다.

## 자격·선발·게임 정책

[일반사항 PDF 4쪽](https://www.jra.go.jp/keiba/program/2026/pdf/bangumi_ippan.pdf#page=4)은 오픈 경주의 일반적 정의를 설명한다. 적용 조건이 달라질 수 있으므로 이를 근거로 JRA·NAR·해외 소속 전체의 출전을 무조건 허용하지 않는다. 신청 자격과 정원 초과 시 선발을 구분하며, 각 소속의 세부 조건과 선발 우선순위는 경주별 자료와 함께 추가 검증한다. [중상경주 PDF 33쪽](https://www.jra.go.jp/keiba/program/2026/pdf/jusyo_kanto.pdf#page=33)은 경주별 자격·선발·등록료의 근거다.

기존 게임용 `minWins: 1`, 항상 14두, 등록비 750,000 KRW 및 1착 상금 65,000,000 KRW 제안은 새로운 출시 기본값의 근거로 삼지 않는다. 기존 R1/R2 테스트 수치는 저장 호환성 용도만 남긴다. 게임 정산 정책은 원통화 금액에 버전 고정 환산율·공통 축소계수를 적용하고 반올림을 명시하는 방향이지만 구체 숫자는 미확정이다. 정산 정책, 출전 자격·선발, 실제 상대 명단 및 기획 승인이 확인되기 전에는 공식 경주를 활성화하지 않는다.
