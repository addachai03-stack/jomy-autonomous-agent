(() => {
  const $ = (id) => document.getElementById(id);
  const orbStage = $("orbStage");
  const statusText = $("statusText");
  const orbCaption = $("orbCaption");
  const micButton = $("micButton");
  const micLabel = $("micLabel");
  const soundButton = $("soundButton");
  const messageInput = $("messageInput");
  const chatForm = $("chatForm");
  const messages = $("messages");
  const emptyState = $("emptyState");
  const activityCount = $("activityCount");
  const activityToggle = $("activityToggle");
  const settingsDialog = $("settingsDialog");
  const endpointInput = $("endpointInput");
  const agentTokenInput = $("agentTokenInput");
  const mcpTokenInput = $("mcpTokenInput");
  const connection = $("connection");
  const voiceHint = $("voiceHint");
  const STORAGE_ENDPOINT = "jomy_agent_endpoint_v1";
  const STORAGE_SOUND = "jomy_agent_sound_v1";
  const STORAGE_TOKEN = "jomy_agent_owner_token_v1";
  const STORAGE_MCP_TOKEN = "jomy_agent_mcp_client_token_v1";
  let endpoint = localStorage.getItem(STORAGE_ENDPOINT) || "";
  let ownerToken = sessionStorage.getItem(STORAGE_TOKEN) || "";
  let mcpToken = sessionStorage.getItem(STORAGE_MCP_TOKEN) || "";
  let soundOn = localStorage.getItem(STORAGE_SOUND) !== "false";
  let recognition = null;
  let listening = false;
  let busy = false;
  let voiceSubmissionPending = false;
  let count = 0;
  let sessionId = sessionStorage.getItem("jomy_agent_session") || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  sessionStorage.setItem("jomy_agent_session", sessionId);

  function setState(state, label, detail) {
    orbStage.dataset.state = state;
    orbCaption.textContent = label;
    statusText.textContent = detail;
  }
  function setConnection(online, label) {
    connection.classList.toggle("online", online);
    connection.querySelector("span").textContent = label;
  }
  function addMessage(role, text) {
    if (emptyState) emptyState.remove();
    const node = document.createElement("article");
    node.className = "message " + role;
    const tag = document.createElement("small");
    tag.textContent = role === "user" ? "YOU" : "JOMY";
    const body = document.createElement("div");
    body.textContent = text;
    node.append(tag, body);
    messages.append(node);
    messages.scrollTop = messages.scrollHeight;
    count++;
    activityCount.textContent = count + (count === 1 ? " message" : " messages");
    if (messages.hidden) {
      messages.hidden = false;
      activityToggle.setAttribute("aria-expanded", "true");
      $("activityChevron").textContent = "−";
    }
  }
  function speak(text) {
    if (!soundOn || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "hi-IN";
    utterance.rate = 1;
    utterance.onstart = () => setState("speaking", "SPEAKING", "JOMY is replying.");
    utterance.onend = () => setState("idle", "READY", "Your command center. Speak or type to begin.");
    window.speechSynthesis.speak(utterance);
  }
  function stopListening() {
    if (recognition && listening) recognition.stop();
    listening = false;
    micLabel.textContent = "Tap to speak";
    micButton.setAttribute("aria-label", "Start voice input");
    if (!busy) setState("idle", "READY", "Your command center. Speak or type to begin.");
  }
  function setupRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      micButton.disabled = true;
      micLabel.textContent = "Use keyboard dictation";
      voiceHint.textContent = "This browser does not expose speech recognition. On iPhone, tap the keyboard microphone and dictate into the message box.";
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = "hi-IN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => {
      listening = true;
      micLabel.textContent = "Listening… tap to stop";
      micButton.setAttribute("aria-label", "Stop voice input");
      setState("listening", "LISTENING", "I'm listening. Say your command.");
    };
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
        else interimText += event.results[i][0].transcript;
      }
      messageInput.value = finalText || interimText;
      if (finalText && !busy && !voiceSubmissionPending) {
        voiceSubmissionPending = true;
        stopListening();
        sendMessage(finalText).finally(() => {
          voiceSubmissionPending = false;
        });
      }
    };
    recognition.onerror = (event) => {
      listening = false;
      micLabel.textContent = "Tap to speak";
      setState("idle", "MIC ISSUE", event.error === "not-allowed" ? "Microphone permission was denied. You can type or use keyboard dictation." : "Voice input stopped. You can type your command.");
    };
    recognition.onend = () => {
      listening = false;
      micLabel.textContent = "Tap to speak";
      if (!busy && orbStage.dataset.state === "listening") setState("idle", "READY", "Your command center. Speak or type to begin.");
    };
  }
  async function sendMessage(rawText) {
    const text = rawText.trim();
    if (!text || busy) return;
    addMessage("user", text);
    messageInput.value = "";
    messageInput.style.height = "auto";
    if (!endpoint) {
      const notice = "I received your message, but the standalone AI chat backend is not connected yet. Add your private HTTPS chat API in Settings to start chatting.";
      addMessage("agent", notice);
      speak(notice);
      return;
    }
    busy = true;
    $("sendButton").disabled = true;
    setState("thinking", "THINKING", "Working on your request…");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(ownerToken ? { "Authorization": "Bearer " + ownerToken } : {}) },
        body: JSON.stringify({ message: text, sessionId, locale: "hi-IN", client: "jomy-autonomous-agent" })
      });
      let data = {};
      try { data = await response.json(); } catch (_) {}
      if (!response.ok) {
        const code = typeof data.code === "string" ? " [" + data.code + "]" : "";
        const detail = typeof data.error === "string" && data.error.trim()
          ? data.error.trim()
          : "Agent endpoint returned HTTP " + response.status;
        throw new Error(detail + code);
      }
      const reply = typeof data.reply === "string" ? data.reply.trim()
        : typeof data.message === "string" ? data.message.trim() : "";
      if (!reply) throw new Error("The agent response did not include a reply string.");
      addMessage("agent", reply);
      speak(reply);
      setConnection(true, "Connected");
    } catch (error) {
      const notice = "Connection problem: " + error.message + ". No task was confirmed as completed.";
      addMessage("agent", notice);
      setState("idle", "CONNECTION ISSUE", "Check your API URL and server status.");
      setConnection(false, "Connection error");
    } finally {
      busy = false;
      $("sendButton").disabled = false;
      if (orbStage.dataset.state === "thinking") setState("idle", "READY", "Your command center. Speak or type to begin.");
    }
  }

  setupRecognition();
  setConnection(false, endpoint ? "Endpoint saved · not tested" : "Not connected");
  soundButton.setAttribute("aria-pressed", String(soundOn));
  soundButton.textContent = soundOn ? "◖))" : "◖×";
  micButton.addEventListener("click", () => {
    if (!recognition) return;
    if (listening) stopListening();
    else {
      try { recognition.start(); } catch (_) { setState("idle", "MIC BUSY", "Wait a moment, then try again."); }
    }
  });
  soundButton.addEventListener("click", () => {
    soundOn = !soundOn;
    localStorage.setItem(STORAGE_SOUND, String(soundOn));
    soundButton.setAttribute("aria-pressed", String(soundOn));
    soundButton.textContent = soundOn ? "◖))" : "◖×";
    if (!soundOn && "speechSynthesis" in window) window.speechSynthesis.cancel();
  });
  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(messageInput.value);
  });
  messageInput.addEventListener("input", () => {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 110) + "px";
  });
  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      chatForm.requestSubmit();
    }
  });
  activityToggle.addEventListener("click", () => {
    const open = activityToggle.getAttribute("aria-expanded") !== "true";
    activityToggle.setAttribute("aria-expanded", String(open));
    messages.hidden = !open;
    $("activityChevron").textContent = open ? "−" : "＋";
  });
  $("settingsButton").addEventListener("click", () => {
    endpointInput.value = endpoint;
    agentTokenInput.value = ownerToken;
    mcpTokenInput.value = mcpToken;
    $("settingsNote").textContent = "";
    settingsDialog.showModal();
  });
  $("saveEndpoint").addEventListener("click", () => {
    const value = endpointInput.value.trim();
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Use HTTPS for the agent endpoint.");
      endpoint = url.toString();
      ownerToken = agentTokenInput.value.trim();
      localStorage.setItem(STORAGE_ENDPOINT, endpoint);
      if (ownerToken) sessionStorage.setItem(STORAGE_TOKEN, ownerToken);
      else sessionStorage.removeItem(STORAGE_TOKEN);
      mcpToken = mcpTokenInput.value.trim();
      if (mcpToken) sessionStorage.setItem(STORAGE_MCP_TOKEN, mcpToken);
      else sessionStorage.removeItem(STORAGE_MCP_TOKEN);
      setConnection(false, "Endpoint saved · not tested");
      $("settingsNote").textContent = "Saved on this device. Send a message to test the connection.";
    } catch (error) {
      $("settingsNote").textContent = error.message || "Enter a valid HTTPS URL.";
    }
  });
  $("testMcpConnection").addEventListener("click", async () => {
    const rawEndpoint = endpointInput.value.trim() || endpoint;
    const testOwnerToken = agentTokenInput.value.trim() || ownerToken;
    const testMcpToken = mcpTokenInput.value.trim() || mcpToken;
    const note = $("settingsNote");
    if (!rawEndpoint || !testOwnerToken || !testMcpToken) {
      note.textContent = "Enter the Secure API URL, Owner access token and dedicated MCP Client token first.";
      return;
    }
    let mcpUrl;
    try {
      const parsed = new URL(rawEndpoint);
      if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error("Use an HTTPS Agent API endpoint.");
      if (!/\/api\/agent\/chat\/?$/.test(parsed.pathname)) throw new Error("Secure API URL must end with /api/agent/chat.");
      parsed.pathname = parsed.pathname.replace(/\/api\/agent\/chat\/?$/, "/api/agent/mcp");
      parsed.search = "";
      parsed.hash = "";
      mcpUrl = parsed.toString();
    } catch (error) {
      note.textContent = error.message || "Enter a valid Agent API URL.";
      return;
    }
    const testButton = $("testMcpConnection");
    testButton.disabled = true;
    testButton.textContent = "Testing…";
    note.textContent = "Checking MCP authentication and status…";
    try {
      const response = await fetch(mcpUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + testOwnerToken
        },
        body: JSON.stringify({ action: "status", mcpToken: testMcpToken }),
        signal: AbortSignal.timeout(20000)
      });
      let data = {};
      try { data = await response.json(); } catch (_) {}
      if (!response.ok) {
        const code = typeof data.code === "string" ? data.code : "HTTP_" + response.status;
        throw new Error(code + ": " + (data.error || "MCP connection was rejected."));
      }
      if (data.status !== "connected") throw new Error(data.error || "MCP did not confirm the connection.");
      ownerToken = testOwnerToken;
      mcpToken = testMcpToken;
      sessionStorage.setItem(STORAGE_TOKEN, ownerToken);
      sessionStorage.setItem(STORAGE_MCP_TOKEN, mcpToken);
      note.textContent = "Connected — MCP authentication and status check passed.";
    } catch (error) {
      note.textContent = "Connection failed: " + (error.name === "TimeoutError" ? "MCP_TIMEOUT: request timed out." : error.message || "Network error.");
    } finally {
      testButton.disabled = false;
      testButton.textContent = "Test MCP connection";
    }
  });
  $("clearEndpoint").addEventListener("click", () => {
    endpoint = "";
    localStorage.removeItem(STORAGE_ENDPOINT);
    endpointInput.value = "";
    ownerToken = "";
    mcpToken = "";
    agentTokenInput.value = "";
    mcpTokenInput.value = "";
    sessionStorage.removeItem(STORAGE_TOKEN);
    sessionStorage.removeItem(STORAGE_MCP_TOKEN);
    setConnection(false, "Not connected");
    $("settingsNote").textContent = "Disconnected on this device.";
  });
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
})();