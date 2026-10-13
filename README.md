# DERBY CAREER

프런트엔드는 루트의 Next.js 앱, 백엔드는 `services/api`의 Fastify/PostgreSQL 서비스다. 각 실행과 lockfile은 분리되어 있다.

## 프런트엔드 로컬 실행

Node.js 22 LTS 최신 패치 또는 24 이상과 pnpm을 사용한다.

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

백엔드 실행과 DB 초기화는 [API 실행 안내](services/api/README.md)를 따른다. Next 서버의 `.env.local`에서 `DERBY_API_URL=http://127.0.0.1:4000`을 지정한다. 실제 API 위치에 맞게 값을 바꾸고 개발 서버를 다시 실행한다. `NEXT_PUBLIC_` 접두어를 붙이지 않는다.

## 공개 이벤트 조회 연동

`/dev/event-catalog`은 개발 서버에서만 열리는 DB 카탈로그 확인 화면이다. 목록·상세·발생 조건·선택지 효과를 확인하고 분류·적용 상태·활성 여부·정렬·페이지를 바꿀 수 있다. 기본 조회는 `ready` 상태의 활성 이벤트 315개다. 전체 상태와 전체 활성 여부를 선택하면 보류 이벤트 35개도 확인할 수 있다. 운영 빌드에서 확인 화면은 404를 반환한다.

연동 경로는 **브라우저 → Next `/api/event-catalog` → Fastify `/v1/events` → PostgreSQL**이다. 읽기 API는 운영 빌드에서도 제공되며 `AUTH_MODE=disabled`에서도 사용할 수 있다. Next 서버가 API에 요청하므로 브라우저용 CORS 설정이나 로그인 토큰은 필요하지 않다. 브라우저 cookie와 Authorization은 전달하지 않는다.

| Next 조회 경로                     | 응답과 사용법                               |
| ---------------------------------- | ------------------------------------------- |
| `GET /api/event-catalog`           | OpenAPI `EventList`: `{ data, pagination }` |
| `GET /api/event-catalog/{eventId}` | OpenAPI `EventDefinition`                   |

목록의 query는 `category`, `enabled`, `status`, `sort`, `order`, `page`, `pageSize`다. 허용 값과 범위는 `contracts/openapi.yaml`과 동일하다. 중복·알 수 없는 query와 잘못된 값은 400으로 거부한다. 목록을 한 번에 전부 내려받지 않고 서버 페이지 단위로 조회한다.

설정이 없거나 잘못되면 503 `API_NOT_CONFIGURED`, API 연결 실패나 서버 오류는 502 `CATALOG_UNAVAILABLE`, 5초 초과는 504 `CATALOG_TIMEOUT`이다. 상세 404와 요청 제한 429도 구분한다. 성공·실패 응답은 캐시하지 않고 화면에서 재시도할 수 있다. 고정 이벤트 데이터로 대체하지 않는다.

기존 `/api/events`와 월간 이벤트의 조건·효과 계약은 새 API 카탈로그와 다르다. 기존 육성 화면과 Local Save는 현재 계산을 유지하며, 조회 화면은 Career 저장을 읽거나 변경하지 않는다. 월간 이벤트와 서버 Career의 쓰기 연동은 운영 인증·기존 저장 이관·레이스 v3 지원을 조율한 뒤 별도로 진행한다. 카탈로그의 초기 보상은 최종 밸런스가 아닌 버전이 있는 제안치다.

## 개발 검사

[코딩 규칙](CONTRIBUTING.md)을 따른다. API 디렉터리에서 포맷·린트·API 타입·계약·테스트를 검사한다. 새 공개 카탈로그 연동 파일도 포맷과 린트 검사 범위에 포함한다.

```bash
cd services/api
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run contract:check
npm test
npm run build
```

루트 프런트엔드에서도 확인한다.

```bash
pnpm exec tsc --noEmit --incremental false
node --import ./services/api/node_modules/tsx/dist/loader.mjs --test tests/*.test.ts
pnpm build
```
