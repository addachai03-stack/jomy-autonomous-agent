import { normalizeAgentEndpoint } from "./voice-utils.js";

(() => {
  const $ = (id) => document.getElementById(id);
  const endpointInput = $("endpointInput");
  const tokenInput = $("agentTokenInput");
  const note = $("settingsNote");
  const endpointKey = "jomy_agent_endpoint_v1";
  const tokenKey = "jomy_agent_owner_token_v1";

  if (!endpointInput || !tokenInput || !note) return;

  $("settingsButton")?.addEventListener("click", () => {
    endpointInput.value = localStorage.getItem(endpointKey) || "https://jomy-autonomous-agent-api.addachai03.workers.dev/api/agent/chat";
    tokenInput.value = localStorage.getItem(tokenKey) || "";
    if (!tokenInput.value) {
      note.textContent = "Is Preview browser mein Owner token saved nahi hai. Apna existing token yahin enter karo; chat mein share mat karo.";
    } else {
      note.textContent = "";
    }
  });

  $("saveEndpoint")?.addEventListener("click", () => {
    const button = $("saveEndpoint");
    try {
      const endpoint = normalizeAgentEndpoint(endpointInput.value);
      localStorage.setItem(endpointKey, endpoint);
      const token = tokenInput.value.trim();
      if (token) localStorage.setItem(tokenKey, token);
      sessionStorage.removeItem(tokenKey);
      note.textContent = "Saved on this iPhone. Endpoint abhi test nahi hua; chat mein ek message bhej kar check karo.";
      button.textContent = "Saved ✓";
      window.dispatchEvent(new Event("jomy:endpoint-saved"));
    } catch (error) {
      note.textContent = error?.message || "Valid HTTPS Agent URL enter karo.";
      button.textContent = "Save endpoint";
    }
  });

  endpointInput.addEventListener("input", () => {
    $("saveEndpoint").textContent = "Save endpoint";
  });
  tokenInput.addEventListener("input", () => {
    $("saveEndpoint").textContent = "Save endpoint";
  });

  $("clearEndpoint")?.addEventListener("click", () => {
    localStorage.setItem(endpointKey, "");
    localStorage.removeItem(tokenKey);
    sessionStorage.removeItem(tokenKey);
    endpointInput.value = "";
    tokenInput.value = "";
    note.textContent = "Disconnected on this iPhone.";
    $("saveEndpoint").textContent = "Save endpoint";
    window.dispatchEvent(new Event("jomy:endpoint-disconnected"));
  });
})();
