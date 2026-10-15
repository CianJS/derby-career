# 보관된 이벤트 원본

`events.expansion.csv-snapshot-2026-10-14.json`은 사용자가 제공한 내보내기/감사 CSV에서 정규화한 원본 1,000행이다. Notion 개정 전 증거와 사건그룹 대응을 보존하는 자료이며 현재 등록 입력이 아니다. importer나 db:seed가 자동으로 읽지 않는다.

현재 등록 입력은 상위 `events.expansion.source.json`이다. 2026-10-15 Notion 일반 보기를 끝까지 읽어 1,000개 고유 ID의 게임 속성 8개를 대조했다. 공통 350개 차이는 0개, 신규650개 중 차이는20개다. 이전/현재 속성과 변경 필드는 `reports/event-expansion.json`의 sourceComparison에 있다. 원본에 없던 승인·서사·위험 결과를 추가하지 않았다. Notion에 사건그룹 필드가 없어 그룹은 이전 감사 CSV 대응을 유지하며 별도 그룹 검토가 필요하다.

상위 `events.drafts.import.json`과 P1 보고서는 더 이전의 격리 검사 snapshot이다. 이전 문법·비활성 가져오기 회귀 테스트용이며 최신 콘텐츠로 사용하지 않는다. P1 snapshot에서 만든 packet과 현행 expansion은 별도 경로이며, 현재 등록에는 expansion 입력을 사용한다.
