const MCP_REST_URL = "https://jomy-personal-mcp.addachai03.workers.dev/agent/v1";

async function callMcpTool(token, name, args = {}) {
  const response = await fetch(MCP_REST_URL, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({ tool: name, arguments: args }),
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error("MCP REST adapter returned HTTP " + response.status + " during " + name);
  }
  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    throw new Error("MCP REST adapter returned an invalid JSON response during " + name);
  }
  if (!payload || payload.ok !== true || !payload.result) {
    const code = typeof payload?.error === "string" ? payload.error : "request_rejected";
    throw new Error("MCP REST adapter rejected the request during " + name + " (" + code + ")");
  }

  const result = payload.result;
  if (result.isError) {
    const message = (result.content || [])
      .filter(item => item && item.type === "text")
      .map(item => item.text || "")
      .join("\n");
    throw new Error(message || "MCP tool call failed during " + name);
  }
  return (result.content || [])
    .filter(item => item && item.type === "text")
    .map(item => item.text || "")
    .join("\n");
}

export async function getMcpStatus(token) {
  const [systemRaw, telegramRaw] = await Promise.all([
    callMcpTool(token, "system_status"),
    callMcpTool(token, "telegram_status")
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

export async function getApprovalStatus(token, approvalId) {
  const raw = await callMcpTool(token, "get_approval_status", { approvalId });
  let result;
  try {
    result = JSON.parse(raw);
  } catch (_) {
    throw new Error("MCP approval status response could not be parsed");
  }
  return {
    id: typeof result.approvalId === "string"
      ? result.approvalId
      : typeof result.id === "string" ? result.id : approvalId,
    action: typeof result.action === "string" ? result.action : "unknown",
    status: typeof result.status === "string" ? result.status : "unknown",
    createdAt: typeof result.createdAt === "string" ? result.createdAt : null,
    expiresAt: typeof result.expiresAt === "string" ? result.expiresAt : null
  };
}

export async function prepareTelegramMessage(token, text) {
  const raw = await callMcpTool(token, "prepare_action", {
    action: "telegram.send_message",
    args: { text }
  });
  try {
    return JSON.parse(raw);
  } catch (_) {
    return { status: "rejected", message: raw };
  }
}
