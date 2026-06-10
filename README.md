# vanam-erp-mcp

사내 AI 챗봇용 **재고 조회 MCP 서버**입니다.

데이터 흐름:

```
사내 포털 → OpenClaw → (이 MCP 서버) → 재고앱 내부 API → DB
```

이 서버는 **조회 전용**입니다. 쓰기(입고/출고/수정) 도구는 제공하지 않습니다.

## 제공 도구

| 도구 | 설명 | 입력 |
| --- | --- | --- |
| `search_items` | 재고 품목을 이름이나 코드로 검색. 품목의 `id`, `code`, `name`, `category`를 반환 | `query` (string, 필수) |
| `get_stock` | 특정 품목의 현재 재고 수량 조회. `itemCode`, `itemName`, `currentQty`를 반환 | `itemId` (number, 필수) |

> 재고 수량을 알려면 먼저 `search_items`로 품목 `id`를 찾은 뒤, 그 `id`로 `get_stock`을 호출합니다.

## 요구 사항

- Node.js 24 이상
- 의존성: [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) (별도 빌드 단계 없음, 순수 JS)

## 설치

```bash
npm install
```

## 환경변수

`.env.example`를 참고하세요.

| 변수 | 설명 |
| --- | --- |
| `MCP_API_TOKEN` | 재고앱 내부 API 인증용 머신 토큰. **재고앱 `.env`의 `MCP_API_TOKEN`과 같은 값**이어야 합니다. |
| `INVENTORY_API_BASE` | 재고앱 내부 API 베이스 URL. 기본값 `http://192.168.0.210:3000` (NAS 내부 IP) |

> `MCP_API_TOKEN`은 절대 git에 커밋하지 마세요. (`.gitignore`에 `.env` 포함)

## 실행

```bash
node server.js
```

이 서버는 **stdio** 기반 MCP 서버이므로, 직접 실행하면 표준 입력을 기다리며 멈춰 있는 것이 정상입니다. 보통은 OpenClaw 같은 MCP 클라이언트가 자식 프로세스로 실행합니다.

## OpenClaw 등록 예시

MCP 서버 설정에 다음과 같이 추가합니다 (예시):

```json
{
  "mcpServers": {
    "vanam-erp": {
      "command": "node",
      "args": ["/절대경로/vanam-erp-mcp/server.js"],
      "env": {
        "MCP_API_TOKEN": "<재고앱과 동일한 머신 토큰>",
        "INVENTORY_API_BASE": "http://192.168.0.210:3000"
      }
    }
  }
}
```

## 동작 방식

- 모든 호출은 `Authorization: Bearer <MCP_API_TOKEN>` 헤더로 재고앱 내부 API에 요청합니다.
- 호출 타임아웃은 15초입니다.
- API 오류·네트워크 오류가 발생해도 예외를 던지지 않고, 에이전트가 이해할 수 있도록 오류 설명 텍스트를 응답에 담아 반환합니다.

### 호출하는 내부 API

| 도구 | 내부 API |
| --- | --- |
| `search_items` | `GET /api/internal/items?search={query}` |
| `get_stock` | `GET /api/internal/stock?itemId={itemId}` |
