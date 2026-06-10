import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ──────────────────────────────────────────────────────────────
// 환경변수
// ──────────────────────────────────────────────────────────────
const TOKEN = process.env.MCP_API_TOKEN;
const BASE = process.env.INVENTORY_API_BASE || "http://192.168.0.210:3000";

if (!TOKEN) {
  // 토큰이 없어도 서버는 뜨게 하되, 경고는 남긴다.
  console.error(
    "[vanam-erp-mcp] 경고: MCP_API_TOKEN 환경변수가 설정되지 않았습니다. " +
      "재고앱 내부 API 인증이 실패할 수 있습니다."
  );
}

// ──────────────────────────────────────────────────────────────
// 공용 호출 헬퍼: 재고앱 내부 API 호출
//   - 실패해도 throw 하지 않고 { error, detail } 객체를 반환한다.
// ──────────────────────────────────────────────────────────────
async function callInternalApi(path) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      let detail;
      try {
        detail = await res.text();
      } catch {
        detail = "(본문을 읽을 수 없음)";
      }
      return { error: res.status, detail };
    }

    return await res.json();
  } catch (err) {
    // 네트워크 오류 / 타임아웃 등
    return { error: "network", detail: String(err?.message || err) };
  }
}

// ──────────────────────────────────────────────────────────────
// MCP 서버
// ──────────────────────────────────────────────────────────────
const server = new Server(
  {
    name: "vanam-erp-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 도구 정의
const TOOLS = [
  {
    name: "search_items",
    description:
      "재고 품목을 이름이나 코드로 검색한다. 예: 'VO2', '타겟'. 품목의 id, code, name, category를 반환한다. 재고 수량을 알려면 이 도구로 먼저 품목 id를 찾은 뒤 get_stock을 호출하라.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "검색어 (품목 이름이나 코드의 일부)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_stock",
    description:
      "특정 품목의 현재 재고 수량을 조회한다. 품목 id가 필요하다(search_items로 먼저 찾을 것). itemCode, itemName, currentQty를 반환한다.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: {
          type: "number",
          description: "품목 id",
        },
      },
      required: ["itemId"],
    },
  },
  {
    name: "list_categories",
    description:
      "재고 품목의 카테고리(분류) 목록과 부모-자식 계층 구조를 조회한다. 인자가 필요 없다. 예: '카테고리 뭐뭐 있어?', '분류 보여줘'. 각 카테고리의 id, 이름, 부모 관계를 반환한다.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_inbound_lots",
    description:
      "특정 품목의 입고 건별 잔여 수량(어느 입고분이 얼마나 남았는지)을 조회한다. 품목 id가 필요하다(search_items로 먼저 찾을 것). 예: 'VO2 2인치 입고 내역 보여줘', '이 품목 어느 입고분이 남았어?'. 입고번호(txNo), 입고일, 잔여수량, 위치 등을 반환한다. 단순 총 재고량만 알고 싶으면 get_stock을 써라.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: {
          type: "number",
          description: "품목 id",
        },
      },
      required: ["itemId"],
    },
  },
  {
    name: "lookup_barcode",
    description:
      "바코드 문자열로 품목 정보를 조회한다. 예: 바코드 'T2VO20125-69-50'이 무슨 품목인지 확인. 품목 id, 코드, 이름, 카테고리, 입고참조번호(refTxNo)를 반환한다.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "바코드 문자열",
        },
      },
      required: ["code"],
    },
  },
];

// 텍스트 응답 헬퍼
function textResult(text) {
  return { content: [{ type: "text", text }] };
}

// ListTools 핸들러
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// CallTool 핸들러
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "search_items") {
      const query = args?.query;
      if (typeof query !== "string" || query.trim() === "") {
        return textResult("오류: 'query'(검색어)는 필수이며 비어 있을 수 없습니다.");
      }

      const data = await callInternalApi(
        `/api/internal/items?search=${encodeURIComponent(query)}`
      );

      if (data && data.error !== undefined) {
        return textResult(
          `품목 검색 중 오류가 발생했습니다 (error=${data.error}). 상세: ${data.detail}`
        );
      }

      // 결과 배열 기대. 일부 API는 { items: [...] } 형태일 수 있어 방어적으로 처리.
      const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];

      if (items.length === 0) {
        return textResult(`검색 결과 없음 (검색어: "${query}")`);
      }

      const lines = items.map(
        (it) =>
          `id=${it.id}, code=${it.code}, name=${it.name}, category=${it.category}`
      );
      return textResult(
        `검색 결과 ${items.length}건 (검색어: "${query}"):\n` + lines.join("\n")
      );
    }

    if (name === "get_stock") {
      const itemId = args?.itemId;
      if (typeof itemId !== "number" || Number.isNaN(itemId)) {
        return textResult("오류: 'itemId'(품목 id)는 필수이며 숫자여야 합니다.");
      }

      const data = await callInternalApi(
        `/api/internal/stock?itemId=${encodeURIComponent(itemId)}`
      );

      if (data && data.error !== undefined) {
        if (data.error === 404) {
          return textResult(`해당 품목 없음 (itemId=${itemId})`);
        }
        return textResult(
          `재고 조회 중 오류가 발생했습니다 (error=${data.error}). 상세: ${data.detail}`
        );
      }

      return textResult(
        `재고 조회 결과 (itemId=${itemId}):\n` +
          `itemCode=${data.itemCode}, itemName=${data.itemName}, currentQty=${data.currentQty}`
      );
    }

    if (name === "list_categories") {
      const data = await callInternalApi("/api/internal/categories");

      if (data && data.error !== undefined) {
        return textResult(
          `카테고리 조회 중 오류가 발생했습니다 (error=${data.error}). 상세: ${data.detail}`
        );
      }

      const categories = Array.isArray(data)
        ? data
        : Array.isArray(data?.categories)
        ? data.categories
        : [];

      if (categories.length === 0) {
        return textResult("카테고리 없음");
      }

      // 부모-자식 트리 구성
      const childrenByParent = new Map();
      for (const cat of categories) {
        const key = cat.parentId === null || cat.parentId === undefined ? "root" : cat.parentId;
        if (!childrenByParent.has(key)) {
          childrenByParent.set(key, []);
        }
        childrenByParent.get(key).push(cat);
      }

      const lines = [];
      const renderTree = (parentKey, depth) => {
        const children = childrenByParent.get(parentKey) || [];
        for (const cat of children) {
          lines.push(`${"  ".repeat(depth)}- ${cat.name} (id=${cat.id})`);
          renderTree(cat.id, depth + 1);
        }
      };
      renderTree("root", 0);

      return textResult(
        `카테고리 목록 (총 ${categories.length}개):\n` + lines.join("\n")
      );
    }

    if (name === "list_inbound_lots") {
      const itemId = args?.itemId;
      if (typeof itemId !== "number" || Number.isNaN(itemId)) {
        return textResult("오류: 'itemId'(품목 id)는 필수이며 숫자여야 합니다.");
      }

      const data = await callInternalApi(
        `/api/internal/inbound-lots?itemId=${encodeURIComponent(itemId)}`
      );

      if (data && data.error !== undefined) {
        return textResult(
          `입고 잔여 조회 중 오류가 발생했습니다 (error=${data.error}). 상세: ${data.detail}`
        );
      }

      const lots = Array.isArray(data)
        ? data
        : Array.isArray(data?.lots)
        ? data.lots
        : [];

      if (lots.length === 0) {
        return textResult(`잔여 입고분 없음 (itemId=${itemId})`);
      }

      const hasValue = (v) => v !== null && v !== undefined && v !== "";

      const lines = lots.map((lot) => {
        let line = `- txNo=${lot.txNo}, 입고일=${lot.txDate}, 잔여=${lot.remainQty}, 위치=${lot.locationName}`;
        if (hasValue(lot.unitPrice)) {
          line += `, 단가=${lot.unitPrice}`;
          if (hasValue(lot.currency)) {
            line += ` ${lot.currency}`;
          }
        }
        if (hasValue(lot.partnerName)) {
          line += `, 거래처=${lot.partnerName}`;
        }
        if (hasValue(lot.memo)) {
          line += `, 메모=${lot.memo}`;
        }
        return line;
      });

      const first = lots[0];
      let header = `입고 건별 잔여 (itemId=${itemId}`;
      if (hasValue(first.itemCode) || hasValue(first.itemName)) {
        const codePart = hasValue(first.itemCode) ? first.itemCode : "";
        const namePart = hasValue(first.itemName) ? first.itemName : "";
        const label = [codePart, namePart].filter((p) => p !== "").join(" ");
        header += `, ${label}`;
      }
      header += `, 총 ${lots.length}건):`;

      return textResult(header + "\n" + lines.join("\n"));
    }

    if (name === "lookup_barcode") {
      const code = args?.code;
      if (typeof code !== "string" || code.trim() === "") {
        return textResult("오류: 'code'(바코드)는 필수이며 비어 있을 수 없습니다.");
      }

      const data = await callInternalApi(
        `/api/internal/barcode?code=${encodeURIComponent(code)}`
      );

      if (data && data.error !== undefined) {
        if (data.error === 404) {
          return textResult(`해당 바코드 없음 (code=${code})`);
        }
        return textResult(
          `바코드 조회 중 오류가 발생했습니다 (error=${data.error}). 상세: ${data.detail}`
        );
      }

      return textResult(
        `바코드 조회 결과 (code=${code}):\n` +
          `itemId=${data.itemId}, code=${data.itemCode}, name=${data.itemName}, category=${data.category}, 입고참조=${data.refTxNo}`
      );
    }

    return textResult(`알 수 없는 도구: ${name}`);
  } catch (err) {
    // 어떤 경우에도 throw 하지 않고 에러 설명을 텍스트로 반환한다.
    return textResult(
      `도구 '${name}' 실행 중 예기치 못한 오류: ${String(err?.message || err)}`
    );
  }
});

// ──────────────────────────────────────────────────────────────
// stdio 연결 (ESM top-level await)
// ──────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[vanam-erp-mcp] MCP 서버가 stdio로 시작되었습니다.");
