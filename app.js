(() => {
  const $ = (id) => document.getElementById(id);
  const orbStage = $("orbStage");
  const statusText = $("statusText");
  const orbCaption = $("orbCaption");
  const micButton = $("micButton");
  const micLabel = $("micLabel");
  const handsFreeButton = $("handsFreeButton");
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
  const connection = $("connection");
  const voiceHint = $("voiceHint");
  const STORAGE_ENDPOINT = "jomy_agent_endpoint_v1";
  const STORAGE_SOUND = "jomy_agent_sound_v1";
  const STORAGE_TOKEN = "jomy_agent_owner_token_v1";
  let endpoint = localStorage.getItem(STORAGE_ENDPOINT) || "";
  let ownerToken = sessionStorage.getItem(STORAGE_TOKEN) || "";
  let soundOn = localStorage.getItem(STORAGE_SOUND) !== "false";
  let recognition = null;
  let listening = false;
  let handsFree = false;
  let awaitingWakeCommand = false;
  let restartTimer = null;
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
  function scheduleHandsFreeStart() {
    clearTimeout(restartTimer);
    if (!handsFree || busy || !recognition) return;
    restartTimer = setTimeout(() => {
      if (!handsFree || busy || listening || ("speechSynthesis" in window && window.speechSynthesis.speaking)) return;
      try { recognition.start(); } catch (_) {}
    }, 700);
  }
  function stopRecognition() {
    clearTimeout(restartTimer);
    if (recognition && listening) { try { recognition.stop(); } catch (_) {} }
    listening = false;
  }
  function stopHandsFree() {
    handsFree = false; awaitingWakeCommand = false; stopRecognition();
    handsFreeButton.setAttribute("aria-pressed", "false"); handsFreeButton.textContent = "Hands-free OFF";
    if (!busy) setState("idle", "READY", "Hands-free is off. Tap to speak or type.");
  }
  function speak(text) {
    if (!soundOn || !("speechSynthesis" in window)) { scheduleHandsFreeStart(); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text); utterance.lang = "hi-IN"; utterance.rate = 1;
    utterance.onstart = () => { stopRecognition(); setState("speaking", "SPEAKING", "JOMY is replying."); };
    utterance.onend = () => { setState("idle", "READY", "Say Hey JOMY when hands-free is on."); scheduleHandsFreeStart(); };
    window.speechSynthesis.speak(utterance);
  }
  function stopListening() {
    stopRecognition(); micLabel.textContent = "Tap to speak"; micButton.setAttribute("aria-label", "Start voice input");
    if (!busy && !handsFree) setState("idle", "READY", "Your command center. Speak or type to begin.");
  }
  function handleHandsFreeResult(transcript) {
    const spoken = transcript.trim(); if (!spoken) return;
    if (awaitingWakeCommand) { awaitingWakeCommand = false; sendMessage(spoken).finally(scheduleHandsFreeStart); return; }
    const wakePattern = /(?:hey|hello|ok|okay|हे)?\s*(?:jomy|jomi|जॉमी|जोमी)(?:\s*सुनो)?/i;
    const match = wakePattern.exec(spoken); if (!match) return;
    const command = (spoken.slice(0, match.index) + " " + spoken.slice(match.index + match[0].length)).trim();
    if (command) sendMessage(command).finally(scheduleHandsFreeStart);
    else { awaitingWakeCommand = true; setState("listening", "AWAKE", "I am listening. Say your command now."); }
  }
  function setupRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      micButton.disabled = true; handsFreeButton.disabled = true; micLabel.textContent = "Voice unavailable";
      voiceHint.textContent = "This browser does not support speech recognition. On iPhone, use the keyboard microphone to dictate.";
      return;
    }
    recognition = new SpeechRecognition(); recognition.lang = "hi-IN"; recognition.interimResults = true; recognition.continuous = false;
    recognition.onstart = () => {
      listening = true; micLabel.textContent = handsFree ? "Listening for Hey JOMY…" : "Listening… tap to stop";
      micButton.setAttribute("aria-label", "Stop voice input");
      setState("listening", handsFree ? "HANDS-FREE" : "LISTENING", handsFree ? "Say Hey JOMY, then your command." : "I am listening. Say your command.");
    };
    recognition.onresult = (event) => {
      let finalText = "", interimText = "";
      for (let n = event.resultIndex; n < event.results.length; n++) { if (event.results[n].isFinal) finalText += event.results[n][0].transcript; else interimText += event.results[n][0].transcript; }
      if (handsFree) { if (finalText && !busy && !voiceSubmissionPending) { voiceSubmissionPending = true; stopRecognition(); handleHandsFreeResult(finalText); voiceSubmissionPending = false; } }
      else { messageInput.value = finalText || interimText; if (finalText && !busy && !voiceSubmissionPending) { voiceSubmissionPending = true; stopListening(); sendMessage(finalText).finally(() => { voiceSubmissionPending = false; }); } }
    };
    recognition.onerror = (event) => {
      listening = false;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") { stopHandsFree(); setState("idle", "MIC PERMISSION", "Allow microphone access in browser settings, then try again."); }
      else if (handsFree) scheduleHandsFreeStart(); else { micLabel.textContent = "Tap to speak"; setState("idle", "MIC ISSUE", "Voice input stopped. You can type your command."); }
    };
    recognition.onend = () => {
      listening = false;
      if (handsFree) { micLabel.textContent = "Hands-free ON"; scheduleHandsFreeStart(); }
      else { micLabel.textContent = "Tap to speak"; if (!busy && orbStage.dataset.state === "listening") setState("idle", "READY", "Your command center. Speak or type to begin."); }
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
      scheduleHandsFreeStart();
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
  handsFreeButton.addEventListener("click", () => {
    if (!recognition) return;
    if (handsFree) { stopHandsFree(); return; }
    handsFree = true; awaitingWakeCommand = false;
    handsFreeButton.setAttribute("aria-pressed", "true"); handsFreeButton.textContent = "Hands-free ON";
    try { recognition.start(); } catch (_) {
      handsFree = false; handsFreeButton.setAttribute("aria-pressed", "false"); handsFreeButton.textContent = "Hands-free OFF";
      setState("idle", "MIC BUSY", "Wait a moment, then enable hands-free again.");
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
      setConnection(false, "Endpoint saved · not tested");
      $("settingsNote").textContent = "Saved on this device. Send a message to test the connection.";
    } catch (error) {
      $("settingsNote").textContent = error.message || "Enter a valid HTTPS URL.";
    }
  });
  $("clearEndpoint").addEventListener("click", () => {
    endpoint = "";
    localStorage.removeItem(STORAGE_ENDPOINT);
    endpointInput.value = "";
    ownerToken = "";
    agentTokenInput.value = "";
    sessionStorage.removeItem(STORAGE_TOKEN);
    setConnection(false, "Not connected");
    $("settingsNote").textContent = "Disconnected on this device.";
  });
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
})();