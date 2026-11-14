const MCP_URL = "https://jomy-personal-mcp.addachai03.workers.dev/mcp";
const PROTOCOL_VERSION = "2025-03-26";

async function readMcpResult(response, stage = "request") {
  const type = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (!response.ok) throw new Error("MCP server returned HTTP " + response.status + " during " + stage + (raw ? ": " + raw.slice(0, 240).replace(/[\\r\\n]+/g, " ") : ""));
  if (!raw) return {};
  if (type.includes("text/event-stream")) {
    const dataLines = raw.split(/\r?\n/).filter((line) => line.startsWith("data:"));
    for (let i = dataLines.length - 1; i >= 0; i--) {
      try { return JSON.parse(dataLines[i].slice(5).trim()); } catch (_) {}
    }
    throw new Error("MCP server returned an unreadable event stream");
  }
  try { return JSON.parse(raw); } catch (_) {
    throw new Error("MCP server returned an invalid response");
  }
}

async function createMcpSession(token) {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "jomy-autonomous-agent", version: "0.3.0" }
      }
    }),
    signal: AbortSignal.timeout(12000)
  });
  const sessionId = response.headers.get("Mcp-Session-Id");
  const selectedVersion = response.headers.get("MCP-Protocol-Version") || PROTOCOL_VERSION;
  const data = await readMcpResult(response, "initialize");
  if (data.error) throw new Error(data.error.message || "MCP initialization failed");
  if (!data.result?.protocolVersion) throw new Error("MCP initialization was not confirmed (initialize response lacked protocolVersion)");
  const headers = {
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": selectedVersion,
    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {})
  };
  const notification = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    signal: AbortSignal.timeout(12000)
  });
  if (!(notification.ok || notification.status === 202)) {
    const detail = await notification.text().catch(() => "");\n    throw new Error("MCP server returned HTTP " + notification.status + " during initialized notification" + (detail ? ": " + detail.slice(0, 240).replace(/[\\r\\n]+/g, " ") : ""));
  }
  return { headers, sessionId };
}

async function callMcpTool(session, id, name, args = {}) {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: session.headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args }
    }),
    signal: AbortSignal.timeout(12000)
  });
  const data = await readMcpResult(response, "tools/call " + name);
  if (data.error) throw new Error(data.error.message || "MCP tool call failed");
  const result = data.result;
  if (!result || result.isError) {
    const message = (result?.content || []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
    throw new Error(message || "MCP tool call failed");
  }
  return (result.content || []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
}

async function closeMcpSession(session) {
  if (!session.sessionId) return;
  try {
    await fetch(MCP_URL, {
      method: "DELETE",
      headers: session.headers,
      signal: AbortSignal.timeout(4000)
    });
  } catch (_) {}
}

export async function getMcpStatus(token) {
  const session = await createMcpSession(token);
  try {
    const [systemRaw, telegramRaw] = await Promise.all([
      callMcpTool(session, 2, "system_status"),
      callMcpTool(session, 3, "telegram_status")
    ]);
    let system, telegram;
    try {
      system = JSON.parse(systemRaw);
      telegram = JSON.parse(telegramRaw);
    } catch (_) {
      throw new Error("MCP status response could not be parsed");
    }
    return { system, telegram };
  } finally {
    await closeMcpSession(session);
  }
}

export async function getApprovalStatus(token, approvalId) {
  const session = await createMcpSession(token);
  try {
    const raw = await callMcpTool(session, 2, "get_approval_status", { approvalId });
    let result;
    try { result = JSON.parse(raw); } catch (_) {
      throw new Error("MCP approval status response could not be parsed");
    }
    return {
      id: typeof result.id === "string" ? result.id : approvalId,
      action: typeof result.action === "string" ? result.action : "unknown",
      status: typeof result.status === "string" ? result.status : "unknown",
      createdAt: typeof result.createdAt === "string" ? result.createdAt : null,
      expiresAt: typeof result.expiresAt === "string" ? result.expiresAt : null
    };
  } finally {
    await closeMcpSession(session);
  }
}

export async function prepareTelegramMessage(token, text) {
  const session = await createMcpSession(token);
  try {
    const raw = await callMcpTool(session, 2, "prepare_action", {
      action: "telegram.send_message",
      args: { text }
    });
    try { return JSON.parse(raw); } catch (_) {
      return { status: "rejected", message: raw };
    }
  } finally {
    await closeMcpSession(session);
  }
}
