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


// A deliberate, single-request diagnostic: never sends saved chat or memory.
export async function testAgentConnection(endpoint, token, request = globalThis.fetch) {
  if (!token || !String(token).trim()) return {ok:false, message:"Owner token needed. Save your private token in Settings."};
  let url;
  try { url = normalizeAgentEndpoint(endpoint); }
  catch (_) { return {ok:false, message:"Invalid API URL. Check the saved HTTPS chat endpoint."}; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await request(url, {
      method:"POST", redirect:"error", cache:"no-store", signal:controller.signal,
      headers:{ "Content-Type":"application/json", "Authorization":"Bearer " + token },
      body:JSON.stringify({message:"Reply briefly with OK to confirm this connection test.",history:[],locale:"hi-IN",client:"jomy-connection-test"})
    });
    if (response.status === 401 || response.status === 403) return {ok:false,message:"Owner authentication rejected. Check your saved token and API permissions."};
    if (response.status === 404) return {ok:false,message:"AI chat route not found. Check your API URL."};
    if (response.status === 429) return {ok:false,message:"AI request limit reached. Try again later."};
    if (response.status === 503) return {ok:false,message:"AI service unavailable or not configured."};
    let data;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      const messages = {
        AI_RATE_LIMITED:"AI provider request limit reached.",
        AI_ALLOCATION_OR_BILLING:"Workers AI allocation or billing limit reached.",
        AI_TIMEOUT:"AI provider timed out. Try again.",
        AI_AUTH_OR_PERMISSION:"AI provider permission rejected."
      };
      return {ok:false,message:Object.hasOwn(messages,data?.code) ? messages[data.code] : "AI test failed (HTTP " + response.status + ")."};
    }
    const reply = typeof data?.reply === "string" ? data.reply : typeof data?.message === "string" ? data.message : "";
    if (!reply.trim()) return {ok:false,message:"Server responded, but no readable AI reply was returned."};
    return {ok:true,message:"AI connection verified. Authenticated chat returned a reply."};
  } catch (error) {
    return {ok:false,message:controller.signal.aborted ? "Connection test timed out. Try again." : "Cannot reach AI API. Check network, HTTPS and browser origin permissions."};
  } finally { clearTimeout(timer); }
}


// Bound the entire JSON request (including response-body read), not only headers.
// No automatic retries: AI requests can consume quota even if the client aborts.
export async function requestAgentJson(url, options, request = globalThis.fetch, timeoutMs = 30000) {
  const controller = new AbortController();
  let timer;
  try {
    const responsePromise = (async () => {
      const response = await request(url, {...options, redirect:"error", cache:"no-store", signal:controller.signal});
      let data;
      try { data = await response.json(); }
      catch (error) {
        if (controller.signal.aborted) throw error;
        if (response.ok) throw new Error("AI response was not valid JSON.");
        data = {};
      }
      return {response,data: data && typeof data === "object" ? data : {}};
    })();
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("AI request timed out. Please retry manually."));
        controller.abort();
      }, timeoutMs);
    });
    return await Promise.race([responsePromise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
