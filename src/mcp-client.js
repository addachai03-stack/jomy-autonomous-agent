const MCP_URL = "https://jomy-personal-mcp.addachai03.workers.dev/mcp";
const PROTOCOL_VERSION = "2025-03-26";

async function readMcpResult(response) {
  const type = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (!response.ok) throw new Error("MCP server returned HTTP " + response.status);
  if (!raw) return {};
  if (type.includes("text/event-stream")) {
    const dataLines = raw.split(/\\r?\\n/).filter((line) => line.startsWith("data:"));
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
  const data = await readMcpResult(response);
  if (data.error) throw new Error(data.error.message || "MCP initialization failed");
  if (!data.result?.protocolVersion) throw new Error("MCP initialization was not confirmed");
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
    throw new Error("MCP initialization notification was rejected");
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
  const data = await readMcpResult(response);
  if (data.error) throw new Error(data.error.message || "MCP tool call failed");
  const result = data.result;
  if (!result || result.isError) {
    const message = (result?.content || []).filter((item) => item.type === "text").map((item) => item.text).join("\\n");
    throw new Error(message || "MCP tool call failed");
  }
  return (result.content || []).filter((item) => item.type === "text").map((item) => item.text).join("\\n");
}

export async function getMcpStatus(token) {
  const session = await createMcpSession(token);
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
}

export async function prepareTelegramMessage(token, text) {
  const session = await createMcpSession(token);
  const raw = await callMcpTool(session, 2, "prepare_action", {
    action: "telegram.send_message",
    args: { text }
  });
  try { return JSON.parse(raw); } catch (_) {
    return { status: "rejected", message: raw };
  }
}
