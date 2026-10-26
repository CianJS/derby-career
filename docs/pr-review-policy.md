# PR 위험도·리뷰·검증 증거 정책

이 문서는 PR 위험도와 독립 리뷰의 공식 원본이다. AI 작업 원칙은 [AGENTS.md](../AGENTS.md), 브랜치·Work 담당·코딩·생성 파일 절차는 [CONTRIBUTING.md](../CONTRIBUTING.md), 기술적 책임 경계는 [코드 책임 지도](codebase-architecture.md), 사용자 승인·병합·배포 권한은 [배포 정책](release-policy.md)을 따른다. 별도 유료 리뷰 API나 AI 서비스를 연결하지 않는다.

## 위험도와 기존 검사 선택

| 위험도 | 변경 예시                                                           | 필수 처리                                             |
| ------ | ------------------------------------------------------------------- | ----------------------------------------------------- |
| LOW    | 문서, 설명 문구, 단순 스타일                                        | 관련 경량 검사와 PR 리뷰                              |
| MEDIUM | 화면 동작, 상태 표시, 일반 API 연동                                 | 관련 기존 CI와 독립 AI 리뷰                           |
| HIGH   | 자금, 저장, DB, 인증, 게임 규칙, 엔진, 공유 계약, CI/배포/보안 설정 | 관련 기존 검사의 실제 실행 여부·결과 확인과 강화 리뷰 |

PR 본문에 `Risk-Level: LOW`, `Risk-Level: MEDIUM`, `Risk-Level: HIGH` 중 **한 줄만** 선언한다. 누락·빈 값·`UNSET`·알 수 없는 값·중복 선언은 무효다. 주석·인용·코드 예제 안의 선언은 인정하지 않는다. [PR 템플릿](../.github/pull_request_template.md)의 영향 항목은 문서 변경처럼 영향이 없으면 `해당 없음`으로 묶어 기록해도 된다.

경로 분석은 **최소 권장 위험도**다. 실제 diff의 의미를 보고 더 높은 위험도로 올릴 수 있다. 예를 들어 UI 문구라도 중요한 정책을 바꾸거나, 화면 파일에 자금 계산을 넣으면 HIGH로 검토한다. 권장보다 낮게 선언하면 경고와 분류 근거를 리뷰어가 실제 코드로 검토해야 한다. 의미적으로 고위험인 변경을 임의로 낮춰 검증을 회피하지 않는다. LOW 선언으로 기존 CI의 실행을 생략할 수 없다. 기존 제품 workflow는 Risk-Level과 무관하게 자신의 변경 경로 조건으로 실행된다.

### 경로 분류 기준

실행 가능한 분류의 원본은 [pr-risk-report.mjs](../scripts/pr-risk-report.mjs)의 `classifyPath`다. 실제 저장소 경로를 기준으로 다음 후보를 HIGH로 다룬다.

- `lib/career/**`, `lib/server-save/**`: 공유 게임 규칙·로컬 저장·서버 저장. 표시용 파일도 이 경로 안에서는 보수적으로 HIGH다.
- `services/api/src/repositories/**`, `services/api/src/modules/{auth,events,racing}/**`, `services/api/src/{config,contracts,db}.ts`, `services/api/src/services/{identity,migrations,seed}.ts`: DB 작업·인증·이벤트/경주 규칙·데이터 무결성.
- `services/api/migrations/**`, `services/api/seeds/**`, SQL/Prisma schema·migration·seed: 영속 데이터와 호환성.
- `packages/shared/src/**`, `contracts/**`, `app/api/server-save/**`: FE/BE 계약과 저장 bridge.
- 인증·권한·세션 파일, middleware/proxy, `.env*`, `vercel.json`, Docker/npm 환경 설정: 권한·배포·보안 후보.
- `.github/**`, 위험도 분석기·그 단위 검사, 게임 감사/개발 서버 저장/DB 배포 스크립트: 검증 기준·실행 환경의 변경.

Markdown 문서는 LOW 후보, 스타일/이미지도 LOW 후보, 그 밖의 일반 코드·설정과 미분류 경로는 MEDIUM 후보다. 미분류 경로는 안전하다는 뜻이 아니며, 추천 검사 목록에 제품 검사가 없어도 리뷰어가 경로 누락 여부를 확인해야 한다. 생성물·테스트·fixture의 변경도 실제 영향을 검토한다. HIGH 변경이 이름 변경으로 문서 폴더에 이동해도 삭제된 원본 경로까지 분석한다.

### 기존 CI의 증거 연결

| Workflow / 실제 job 이름                 | 기존 검증 범위                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `Backend foundation` / `verify`          | 포맷·린트·API 타입·계약·이벤트 생성물·단위 검사·PostgreSQL·빌드·컴파일된 HTTP 서버   |
| `Backend foundation` / `verify-vercel`   | 별도 DB의 배포 migration·참고 자료 import·Vercel 함수 빌드/실행 검증 (배포하지 않음) |
| `Backend foundation` / `verify-frontend` | Next 타입·루트 의존성만의 빌드·Frontend 단위/통합 타입·실행 검사                     |
| `Browser E2E` / `catalog-chromium`       | 기존 Chromium·실제 HTTP·PostgreSQL 흐름과 실패 증거 artifact                         |
| `PR governance` / `risk-report`          | 변경 경로·위험도 선언·분석기 입력/실패 사례만 검사                                   |

PR의 **최신 head commit**과 Checks의 해당 workflow run/job URL을 함께 기록한다. 로컬 검사는 명령·환경·결과를 기록하고 CI 성공과 혼동하지 않는다. 오래된 head의 성공은 새 변경의 증거가 아니다. `pending`, `cancelled`, `skipped`, 실행 누락·조회 불가는 통과로 표시하지 않는다. 예상되는 검사가 없으면 실제 workflow의 `paths`, 이벤트와 GitHub 제한을 확인해 미실행 사유를 남긴다.

위험도 보고는 검사를 대신 실행하거나 성공을 조회하는 도구가 아니다. 제품 검사는 기존 두 workflow만 사용한다. 이 작업의 경량 workflow에는 DB·게임 테스트·빌드·브라우저 실행이 없다.

## 독립 리뷰

ChatGPT 총괄 또는 별도 AI 리뷰어는 구현 Work의 설명을 사실로 전제하지 않고, 관련 Issue·현재 base/head의 실제 diff·주변 호출부·계약·실행 증거를 직접 확인한다. 확인할 항목은 다음과 같다.

1. 관련 Issue 요구사항 충족과 미구현 범위.
2. 이번 변경이 유발하는 회귀 가능성.
3. FE/BE 책임 경계 위반과 불필요한 리팩터링·중복 구현.
4. Local/Server 저장·기존 데이터·공유 계약 호환성.
5. 인증·권한·소유권·원자성·중복 처리 등 데이터 무결성.
6. 실제 실행 결과와 완료 보고의 일치.
7. 관련 기존 자동 검사의 최신 head 실행·통과 여부.
8. 변경과 관계없는 기존 문제의 오분류 여부.

HIGH는 관련 저장/인증/DB/게임 불변 조건과 실패 경로를 더 깊게 추적하고, 관련 기존 테스트의 커버리지를 확인한다. 필요한 증거가 없으면 검증되지 않은 부분과 담당 Work를 기록한다. 새 QA 프로젝트나 게임 테스트 복제를 요구하는 절차가 아니다.

### 결함 기록 형식

```text
Severity: Blocker / Important / Minor
Status: Confirmed / Suspected / Pre-existing

File:
Line:
Problem:
Root cause:
Evidence:
Impact:
Suggested fix:
Related check:
```

- `Blocker`: 데이터 손상·권한 우회·핵심 기능 중단 등 병합 전에 해결해야 하는 결함. `Important`: 요구사항 누락·회귀 등 기능에 실질적인 영향. `Minor`: 핵심 동작을 막지 않는 제한적인 문제.
- `Confirmed`: 코드·로그·테스트의 구체적 근거가 있다. `Suspected`: 합리적 의심이며 검증이 끝나지 않았다. `Pre-existing`: base에도 존재함을 확인했다. 기존 문제를 이번 PR이 악화했다면 그 추가 영향을 구분한다.
- 파일·줄 번호·원인을 확인하지 못했다면 `미확인`으로 남긴다. 추정 위치나 원인을 사실처럼 만들지 않는다. Evidence에는 기준 commit·재현 또는 코드 근거를 연결한다.
- 문제가 확인되지 않았으면 결함을 억지로 만들지 않고 검토한 범위와 남은 한계를 적는다. AI 리뷰만으로 자동 승인·병합하지 않는다.

### 수정 후 재검토

각 지적에 기존 댓글 링크 또는 항목 식별자를 유지한다. 새 head의 diff를 기준으로 해결/미해결을 갱신하고 해결 근거를 남긴다. 새 결함은 별도 기록한다. 같은 문제가 반복되면 기존 지적·근거를 참조하고 복제하지 않는다. 원인이 불명확하면 부족한 증거·다음 확인 항목을 기록하고 무한 재시도하지 않는다.

## 경량 자동화와 호환성

`pr-governance.yml`은 PR의 `opened`, `synchronize`, `reopened`, `edited`, `ready_for_review`에 실행된다. `edited`는 본문 위험도 수정과 base 변경을 반영한다. 읽기 전용 `contents: read`, Node 22와 기본 Git만 사용하며 별도 패키지 설치·비밀키·외부 리뷰 API가 없다. PR 본문은 셸에 삽입하지 않고 `GITHUB_EVENT_PATH`의 JSON으로 읽는다.

- 전체 Git 이력을 checkout하고 `base...head`의 NUL 구분 diff를 읽는다. base에서만 바뀐 파일을 제외하며, 이름 변경 전/후 경로·삭제 파일도 포함한다. API 파일 목록의 페이지/상한을 사용하지 않는다. Summary 표는 200개까지만 표시하지만 분류는 전체 경로를 대상으로 한다.
- 대상 **base의 첫 부모 이력**에서 이 정책 파일이 처음 추가된 커밋 시각을 도입 시점으로 사용한다. 기본 merge/squash에서는 develop에 들어온 시각이다. rebase 병합처럼 이력을 다시 쓰는 방식은 커밋 시각의 의미를 관리자가 확인해야 한다.
- 도입 전 생성된 PR과 정책 도입 PR은 잘못된 선언을 **경고**로 기록한다. 유효한 값으로 처리하지 않는다. 도입 이후 생성된 PR은 무효 선언일 때 메타데이터 검사가 실패한다. 경로 최소 권장보다 낮은 유효 선언은 항상 경고하며 최종 분류는 실제 diff 리뷰로 결정한다. PR 본문의 임의 날짜·표식으로 기존 PR 예외를 선택할 수 없다.
- 대상 base에 정책 도입 이력이 아직 없으면 호환 모드다. 첫 도입/새 base의 검증은 리뷰어가 확인한다. 기존 PR도 제출자는 위험도와 증거를 보완한다. 경고 모드가 기존 제품 CI 실패를 숨기지 않는다.
- 종료 코드 `0`: 분석 완료 (기존 PR에는 경고가 있을 수 있음), `1`: 신규 PR 메타데이터 실패, `2`: 입력/분석 도구 오류. Summary에 원인을 구분한다. 분석 실패를 제품 테스트 실패 또는 제품 정상으로 오인하지 않는다.
- PR 소스의 workflow/스크립트 자체도 변경될 수 있으므로 이 보고서는 악의적 변경을 막는 독립 보안 장치가 아니다. 해당 파일의 diff와 공식 정책 변경은 사람이 확인한다.

위험도 스크립트나 문서만 바뀌어도 기존 제품 검사 조건을 우회시키지 않는다. 런타임 파일이 함께 바뀌면 기존 제품 CI가 계속 실행된다. `continue-on-error` 추가, 테스트 삭제, 전역 린트 비활성화, 빈 검사 명령, 실패를 숨기는 조건/예외 처리로 통과시키지 않는다.

### 경량 검증과 실행 방법

```bash
# 의존성 설치 없이 위험도 분석기의 정상·실패 입력과 실제 임시 Git 이력 검증
node --test scripts/pr-risk-report.test.mjs
node --check scripts/pr-risk-report.mjs

# 로컬의 실제 PR 이벤트 JSON으로 동일 분석 실행 (base/head commit 이력이 필요)
GITHUB_EVENT_PATH=/absolute/path/pr-event.json node scripts/pr-risk-report.mjs

# 포맷은 기존 API의 Prettier와 루트 설정 재사용. 변경한 파일만 지정한다.
# services/api 의존성이 없다면 기존 설치 절차인 npm ci --prefix services/api 사용
node services/api/node_modules/prettier/bin/prettier.cjs --check <changed-files>
git diff --check
```

단위 사례는 위험도 상향/하향·누락·중복·UNSET·악성 입력·3,000개 초과 경로·이름 변경/삭제·base 전용 변경·정책 병합일·기존/신규 PR·CLI 실패 코드를 검사한다. 실제 게임 테스트를 복제하지 않는다. 문서 변경에 신규 브라우저 QA를 요구하지 않는다.

## DEV-OPS-01 도입 시 변경·제약 기록

기준: `develop`의 `6c9ffba746818f08452239fef9a0f9ae3a311d39`.

| 항목              | 변경 전                                                                     | 변경 후                                                                                    |
| ----------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| AI 지침           | AGENTS에 협업·포맷·생성물·검사 명령 일부 중복                               | 공식 원본 링크와 AI 작업·증거 보고 원칙으로 정리; Next 블록/CLAUDE 참조 보존               |
| 병합 권한         | CONTRIBUTING은 CI/리뷰 후 병합으로 읽히고 release-policy는 main 승인만 명시 | 사용자의 명시적 정책에 따라 develop 구현 PR도 사용자 승인 필요; 승인 원본은 release-policy |
| FE/BE 책임        | 기존 Work와 공유 코드 경계                                                  | 그대로 유지; 통합 개발 환경 Work 범위와 상대 담당 인계 경로만 명확화                       |
| Backend PR 경로   | README/AGENTS/CONTRIBUTING 및 API/공유 패키지 내부 문서로 무거운 검사 실행  | Markdown만 변경 시 제품 CI 제외; 혼합 PR의 코드/테스트는 계속 검사                         |
| Backend 누락 경로 | public, PostCSS, 루트 Vercel 설정, Playwright 설정이 누락                   | `public/**`, `postcss.config.mjs`, `vercel.json`, `playwright.config.ts` 추가              |
| Browser PR 경로   | public/PostCSS 누락, API/공유 문서 변경에도 브라우저 실행                   | public/PostCSS 추가; Markdown만 변경 시 제외                                               |
| 위험도 스크립트   | 없음; scripts 변경은 Backend 전체 실행                                      | 분석기와 그 단위 검사 두 파일만 경량 workflow로 분리; 다른 scripts 조건 유지               |
| 실행 명령/이벤트  | 기존 Backend push와 Browser push/수동 실행, 모든 job·테스트·timeout         | 전부 유지; 위험도 보고 PR 이벤트만 추가                                                    |

루트 Vercel 설정은 배포 설정 후보라 Backend의 기존 Frontend 빌드/통합 결과와 설정 diff를 확인하지만 로컬 CI가 실제 배포 설정의 정확성까지 보장하지는 않는다. Browser는 실제 소비하는 public/PostCSS 변경만 추가한다. 공통 계약은 기존처럼 두 제품 workflow 모두 실행된다. workflow 자체 변경은 각각 자신의 기존 검사를 실행하며, 새 governance workflow만 변경한 경우 제품 검사를 추가하지 않는다. Backend의 기존 브랜치 push 검사는 문서만 병합되어도 그대로 실행한다. 통합 이후 검사를 임의로 줄이지 않는다.

Backend의 단위/HTTP/PostgreSQL 검사, Frontend의 bridge/controller 통합 검사, Browser의 실제 Chromium 흐름은 관찰하는 경계가 달라 중복 게임 테스트로 제거하지 않았다. Browser 실행 준비의 빌드도 실제 HTTP 서버를 띄우는 데 필요하다. 새 workflow에는 이 명령을 복제하지 않았다.

### 관리자 설정과 미해결 한계

- 도입 시 조회한 develop 응답은 `protected: false`, Required Check 목록은 비어 있었다. 조회된 저장소 ruleset `vercel`도 `enforcement: disabled`였다. 이는 해당 시점 조회 결과이며 영구 설정의 보증이 아니다. 설정 변경은 하지 않는다.
- 별도 후속 승인으로 필수 검사를 설정한다면 새 job 이름은 `risk-report` (`PR governance`)다. 이 검사는 메타데이터/분석기만 확인하며 제품의 정상 동작이나 사용자 승인을 보증하지 않는다. 설정하지 않은 상태에서 workflow 실패를 강제 병합 차단이라고 표현하지 않는다.
- 기존 체크 이름은 `verify`, `verify-vercel`, `verify-frontend`, `catalog-chromium`이다. 이 workflow에는 `paths` 필터가 있으므로 전 PR에 무조건 필수로 지정하면 문서 PR이 Pending으로 막힐 수 있다. 조건부 필수 검사/집계 방식은 관리자 후속 설계·승인 대상으로 남기며 이번에 성공을 위장하는 집계 job을 추가하지 않는다.
- GitHub의 workflow `paths` 판단에는 300개 파일 제한 등이 있다. 위험도 보고는 전체 diff를 분석하지만 기존 CI를 강제 호출하지는 않는다. 대규모 PR에서 관련 검사가 누락되면 실제 실행 여부를 확인하고 범위를 나누거나 승인된 기존 실행 절차로 확인한다. LOW 선언으로 누락을 정당화하지 않는다.
- 확인된 문서 불일치는 develop 승인 문구에 한정해 사용자 지시에 맞게 정리했다. 기존 브랜치·데이터·저장·생성 파일 정책은 삭제하지 않았다. 알려진 미해결 사항은 경로 분석의 의미적 한계, 대상 base의 정책 도입 이력, 관리자 필수 검사 설정과 실제 독립 리뷰 수행 여부다. 자동 AI 리뷰 연결·담당 Work의 런타임 수정은 이 작업에 없다.

GitHub 공식 근거: [경로 필터·diff 제한](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow), [권한과 workflow 구문](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [필수 검사와 skipped workflow](https://docs.github.com/en/enterprise-cloud%40latest/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).
