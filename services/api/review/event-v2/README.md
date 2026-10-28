# 이벤트 V2 검토 자료 — 활성화 금지

기준 develop e06bad2. 이벤트 350 + 650 = 1,000개 및 Local fixture 30개 ID를 **기계적으로 전수 검사**한 자료다. 수동으로 1,000개 이야기를 완성·승인했다는 뜻이 아니다. 실제 스토리 검토 완료 수는 0이며 각 ID에 검토 과제를 남긴다.

## 사용 순서와 산출물

1. COUNTS.md에서 활성/보류/우선순위 건수를 확인한다. A/B/C는 한 사건이 중복 집계될 수 있다.
2. report.json의 ID/해시 manifest와 records-01~10.json에서 ID별 현재 Server/Local/신규 원문/기존 공통 원문을 나란히 확인한다. 조건·timing·weight·scope·효과 수치·revision/sourceDigest·mappingNotes와 실제 엔진 표본 결과가 포함된다.
3. inventory.csv 및 packet.json manifest의 proposals-01~10.json에서 변경 전후 설명/선택지/효과와 numericChanges의 path, before, after, 근거, 기대 영향을 확인한다. before==after는 수정 보류/수치 유지라는 뜻이다. 원문을 임의로 효과에 매핑하지 않는다.
4. distribution.json은 고정 seed 6,000개월의 기존 Local/Server 선택기 관찰이다. 실제 발생 확률·보장·가중치를 그대로 사용한다. 선택지 선택은 검토용 균등 표본이며 최적 플레이 전략이 아니다. effectDirections/valueRanges는 기존 활성 Server 정의만 실제 Resolver로 계산한 결과다.
5. preservation.json은 원본·활성 카탈로그·공유 규칙·기존 선택기/Resolver의 SHA-256이다. 파일 변경·DB 연결·import 없이 동일 입력으로 재생성된다.

## 문제 유형·우선순위

- **A**: 실행 불가/미지원 mappingNotes, schema/revision 오류, 실제 행동과 효과 timing 불일치, 도달 불가 훈련 조건, 350 공통 원본과 최신 원본의 속성 차이. 데이터 오류와 의도적인 원문 개정/보류를 같은 결함으로 단정하지 말고 evidence를 읽는다.
- **B**: 동일 조건·효과 선택지, 경고선을 넘는 단일 효과 및 명시적인 기획 대안. 경고선은 능력 +20/상태 ±15/배율 1.5/확정 성장 ratio 0.5이며 **검토용 휴리스틱**이다. 공식 합의된 밸런스 규칙으로 적용하지 않는다. 경고가 없다고 균형이 증명된 것은 아니다. 경고선 초과와 별개로 COM-0001(배율 1.45→1.35, 추가 피로 5→3), COM-0002(추가 부하 7→6), COM-0016(확정 성장 ratio 0.45→0.35)의 명시적인 기획 대안 4건을 제시한다. 저부담 조교/무비용 성장 누적 완화 후보이며 승인되지 않았다. report의 proposedObservations는 같은 기존 Resolver로 전후를 비교한다.
- **C**: 본문·출처 없음, 제목/규칙 중복, 형식적 선택지, Local/Server 문구 차이, 반말/외국어 후보. 중복 규칙은 의도적일 수 있고 외국어는 고유명사일 수 있어 false positive는 manual_review로 구분한다. 반말 탐지의 좁은 규칙 외 문체도 검토 대상이다.

검토용 after 문장은 조건·적용 시점 설명을 보강한 후보로, 현장 경마의 현실성이나 독창적인 서사 품질을 보증하지 않는다. 본문 부재 항목은 스토리 설계 검토 필요로 남긴다. 히든·engine_gap·needs_mapping·원본 충돌 항목은 **무조건 hold**다. 276개 확장 실행 가능 표시와 실제 문장·밸런스·그룹 승인 완료는 서로 다르다. 현재 승격 가능 0개다.

## 밸런스와 분포 한계

- 실제 능력치 범위 0~1000, 피로/부하 최소 0(상한 없음), 관계별 신뢰도 0~100, 한 달 최대 1개, 발생 30%/3개월 보장을 그대로 사용한다.
- 카테고리 45:35:12:6:2와 손익 크기 목표 15:55:25:5는 검토 기준이다. 현재 RISK_WEIGHTS의 great_success/success/failure/disaster 확률과 손익 크기 비율을 같은 의미로 간주하지 않는다. 현재 활성 풀의 카테고리가 common뿐이므로 확장 목표 비율을 재현하지 않는다. 비활성 사건을 표본에 섞어 목표에 맞추지 않는다.
- 보장으로 실측 등장률은 30%를 초과할 수 있다. 비용·성장 간 가치를 임의의 단일 점수로 합산하지 않으며 mixed/benefit/cost/neutral을 구분한다. 큰/작은 손익 목표의 완전한 비교는 교환 가치·경계 승인 전까지 미완료다.
- 건강 4종, 턴1/12/13/60/61/84, 상한/과로, 실제 훈련/휴식/치료 결과를 표본 검사한다. 미등장은 발동 불가의 증거가 아니다. 모형에 없는 원정·성별·미래 조건/효과를 추정하거나 fallback으로 실행하지 않는다.
- 공유 계산이 시간/확률/임의 seed로 바뀌는지 재현성 테스트로 검사한다. 테스트 외 RNG/DB 부작용은 없다. 기존 golden regression digest와 원본 해시도 보존한다.

## 비실행 보장과 후속

분할 packet을 합친 내용은 format=event-v2-review-only / applicationAllowed=false이며 각 row는 enabled=false / executable=false다. 기존 catalog/draft import 스키마와 호환되지 않는다. 이 파일은 런타임에서 import하지 않고 API/FE 도감에도 노출하지 않는다. 누군가 검토 문서를 승인해도 이 packet을 그대로 import할 수 없다.

총괄의 ID별 문구/수치/조건·효과 승인 후 별도 버전/revision PR로 개정한다. 원본 snapshot·열린 월 선택지·발생 확률·weight·Save/replay·DB는 이번 PR에서 변경하지 않는다. FE/API 계약 변경은 없고 후속에서 Local/Server 문구 차이를 조율해야 한다.

재생성: services/api에서 `node --import tsx scripts/audit-event-quality.ts`. 기존 `npm test`의 event-review-regressions 검사가 coverage·고정 seed·위변조·활성화 거부·불변성을 검증한다. DB migration/seed/import 명령이나 새 브라우저 E2E는 필요 없다.
