export function parseWakeCommand(finalText, finalCandidates = [], waitingForCommand = false) {
  const primary = typeof finalText === "string" ? finalText.trim() : "";
  if (waitingForCommand) return primary;
  const wakePattern = /(?:^|[\s,])(?:hey\s*)?(?:jomy|jo\s*my|jomi|जोमी|जो\s*मी|जॉमी|ज्योमी)(?=$|[\s,.!?])/i;
  const transcript = wakePattern.test(primary)
    ? primary
    : finalCandidates.find((candidate) => typeof candidate === "string" && wakePattern.test(candidate)) || "";
  if (!transcript) return null;
  return transcript.replace(wakePattern, "").replace(/^[\s,!.]+/, "").trim();
}

export function extractTelegramMessage(text) {
  if (typeof text !== "string") return null;
  const patterns = [
    /^(?:telegram|टेलीग्राम)\s+(?:par|pe|पर|पे)\s+(?:message\s+)?(?:bhejo|bhej\s+do|send\s+karo|भेजो|भेज\s+दो|संदेश\s+भेजो)\s*[:,-]?\s*([\s\S]+)$/i,
    /^(?:send|bhejo)\s+(?:this\s+)?on\s+telegram\s*[:,-]?\s*([\s\S]+)$/i
  ];
  for (const pattern of patterns) {
    const match = text.trim().match(pattern);
    if (match && match[1]?.trim()) return match[1].trim();
  }
  return null;
}


export function discardPendingVoiceCapture(state, clearTimer = clearTimeout) {
  const timer = state && state.timer !== undefined ? state.timer : null;
  if (timer !== null) clearTimer(timer);
  return { ...state, transcript: "", timer: null, discardResults: true };
}

export function normalizeAgentEndpoint(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    throw new Error("Use HTTPS for the Agent endpoint.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Agent URL mein username, password, query ya fragment nahi hona chahiye.");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (!path || path === "/" || path === "/api/agent") {
    url.pathname = "/api/agent/chat";
  } else if (path === "/api/agent/chat") {
    url.pathname = path;
  } else {
    throw new Error("Use the Agent chat URL ending in /api/agent/chat.");
  }
  return url.toString();
}
