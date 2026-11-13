import { parseWakeCommand, extractTelegramMessage } from "./voice-utils.js";
import { createTask, addTask } from "./task-engine.js";

(() => {
  const $ = (id) => document.getElementById(id);
  const orbStage = $("orbStage");
  const statusText = $("statusText");
  const orbCaption = $("orbCaption");
  const micButton = $("micButton");
  const micLabel = $("micLabel");
  const soundButton = $("soundButton");
  const handsFreeButton = $("handsFreeButton");
  const messageInput = $("messageInput");
  const chatForm = $("chatForm");
  const messages = $("messages");
  const emptyState = $("emptyState");
  const activityCount = $("activityCount");
  const activityToggle = $("activityToggle");
  const activityBoard = document.querySelector(".activity");
  const taskForm = $("taskForm");
  const taskInput = $("taskInput");
  const taskList = $("taskList");
  const taskCount = $("taskCount");
  const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1";
  let taskQueue = [];
  try {
    const savedTasks = JSON.parse(localStorage.getItem(TASK_QUEUE_KEY) || "[]");
    if (Array.isArray(savedTasks)) taskQueue = savedTasks.filter(task => task && typeof task.id === "string" && typeof task.title === "string" && ["queued", "planning", "awaiting_approval", "ready", "running", "retry_wait", "succeeded", "failed", "blocked"].includes(task.status)).slice(-30);
  } catch (_) {}
  const settingsDialog = $("settingsDialog");
  const endpointInput = $("endpointInput");
  const agentTokenInput = $("agentTokenInput");
  const mcpTokenInput = $("mcpTokenInput");
  const connection = $("connection");
  const voiceHint = $("voiceHint");
  const STORAGE_ENDPOINT = "jomy_agent_endpoint_v1";
  const STORAGE_SOUND = "jomy_agent_sound_v1";
  const STORAGE_HANDSFREE = "jomy_agent_handsfree_v1";
  const STORAGE_TOKEN = "jomy_agent_owner_token_v1";
  const STORAGE_MCP_TOKEN = "jomy_mcp_client_token_v1";
  let endpoint = localStorage.getItem(STORAGE_ENDPOINT) || "";
  let ownerToken = sessionStorage.getItem(STORAGE_TOKEN) || "";
  let mcpClientToken = sessionStorage.getItem(STORAGE_MCP_TOKEN) || "";
  let soundOn = localStorage.getItem(STORAGE_SOUND) !== "false";
  let recognition = null;
  let listening = false;
  let recognitionBlocked = false;
  let recognitionStarting = false;
  let speakingReply = false;
  let handsFree = localStorage.getItem(STORAGE_HANDSFREE) === "true";
  let waitingForCommand = false;
  let busy = false;
  let voiceSubmissionPending = false;
  let voiceFinalTranscript = "";
  let voiceSendTimer = null;
  let count = 0;
  let sessionId = sessionStorage.getItem("jomy_agent_session") || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  sessionStorage.setItem("jomy_agent_session", sessionId);
  const HISTORY_KEY = "jomy_agent_history_v1";
  let conversationHistory = [];
  try {
    const savedHistory = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]");
    if (Array.isArray(savedHistory)) conversationHistory = savedHistory.filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string").slice(-10).map(item => ({ role: item.role, content: item.content.slice(0, 2000) }));
  } catch (_) {}
  function saveConversationHistory() {
    conversationHistory = conversationHistory.slice(-10);
    try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(conversationHistory)); } catch (_) {}
  }

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
    conversationHistory.push({ role: role === "user" ? "user" : "assistant", content: String(text).slice(0, 2000) });
    saveConversationHistory();
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
  function saveTaskQueue() {
    taskQueue = taskQueue.slice(-30);
    try { localStorage.setItem(TASK_QUEUE_KEY, JSON.stringify(taskQueue)); } catch (_) {}
  }
  function renderTaskQueue() {
    taskCount.textContent = taskQueue.length + "/30";
    taskList.replaceChildren();
    if (!taskQueue.length) {
      const empty = document.createElement("p");
      empty.className = "task-empty";
      empty.textContent = "No tasks yet. Add a task you want JOMY to organize.";
      taskList.append(empty);
      return;
    }
    for (const task of taskQueue) {
      const item = document.createElement("article");
      item.className = "task-item";
      const details = document.createElement("div");
      details.className = "task-details";
      const title = document.createElement("strong");
      title.textContent = task.title;
      const status = document.createElement("small");
      status.textContent = task.status.replaceAll("_", " ").toUpperCase() + " · " + new Date(task.updatedAt || task.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
      details.append(title, status);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "task-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove task");
      remove.addEventListener("click", () => {
        taskQueue = taskQueue.filter(entry => entry.id !== task.id);
        saveTaskQueue();
        renderTaskQueue();
      });
      item.append(details, remove);
      taskList.append(item);
    }
  }
  taskForm.addEventListener("submit", event => {
    event.preventDefault();
    const value = taskInput.value.trim();
    if (!value) return;
    if (taskQueue.length >= 30) {
      taskCount.textContent = "Queue full";
      return;
    }
    taskQueue = addTask(taskQueue, createTask(value));
    saveTaskQueue();
    renderTaskQueue();
    taskInput.value = "";
  });
  function wakeActivityBoard() {
    messages.hidden = false;
    activityToggle.setAttribute("aria-expanded", "true");
    $("activityChevron").textContent = "−";
    if (emptyState) emptyState.textContent = "JOMY is awake. Tell me what you need.";
    activityBoard.classList.add("is-awake");
    window.setTimeout(() => activityBoard.classList.remove("is-awake"), 2600);
  }
  function unlockSpeech() {
    if (!("speechSynthesis" in window) || !soundOn) return;
    try {
      const primer = new SpeechSynthesisUtterance(" ");
      primer.volume = 0;
      window.speechSynthesis.speak(primer);
      window.speechSynthesis.resume();
    } catch (_) {}
  }
  function speak(text) {
    if (!soundOn || !("speechSynthesis" in window)) {
      speakingReply = false;
      if (handsFree) startRecognition();
      return;
    }
    if (recognition && listening) {
      try { recognition.stop(); } catch (_) {}
      listening = false;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    speakingReply = true;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "hi-IN";
    utterance.rate = 0.92;
    const voices = synth.getVoices();
    const hindiVoice = voices.find((voice) => /^hi([-_]|$)/i.test(voice.lang));
    if (hindiVoice) utterance.voice = hindiVoice;
    utterance.onstart = () => setState("speaking", "SPEAKING", "JOMY is replying.");
    utterance.onend = () => {
      speakingReply = false;
      setState("idle", handsFree ? "HANDS-FREE ACTIVE" : "READY", handsFree ? "Say JOMY, then give your command." : "Your command center. Speak or type to begin.");
      if (handsFree) startRecognition();
    };
    utterance.onerror = (event) => {
      speakingReply = false;
      voiceHint.textContent = "Reply text is ready, but iPhone audio playback failed (" + (event.error || "unknown") + "). Tap Sound once, then try again.";
      setState("idle", "AUDIO PAUSED", "Tap Sound to re-enable voice replies.");
      if (handsFree) startRecognition();
    };
    synth.resume();
    synth.speak(utterance);
  }
  function startRecognition() {
    if (!recognition || !handsFree || busy || listening || recognitionStarting || recognitionBlocked || speakingReply) return;
    try {
      recognitionStarting = true;
      recognition.start();
    }
    catch (_) {
      recognitionStarting = false;
      recognitionBlocked = true;
      micLabel.textContent = "Tap to retry microphone";
      voiceHint.textContent = "Safari paused microphone startup. Tap the Hands-free button or microphone once to retry.";
      setState("idle", "MICROPHONE PAUSED", "Tap once to retry voice listening.");
    }
  }
  function stopHandsFree() {
    handsFree = false;
    localStorage.setItem(STORAGE_HANDSFREE, "false");
    waitingForCommand = false;
    if (recognition && listening) {
      try { recognition.stop(); } catch (_) {}
    }
    listening = false;
    recognitionStarting = false;
    handsFreeButton.textContent = "Hands-free: Off";
    handsFreeButton.setAttribute("aria-pressed", "false");
    micLabel.textContent = "Tap to speak";
    setState("idle", "READY", "Hands-free is off. Tap the mic to speak.");
  }
  function stopListening() {
    if (recognition && listening) recognition.stop();
    listening = false;
    micLabel.textContent = "Tap to speak";
    micButton.setAttribute("aria-label", "Start voice input");
    if (!busy) setState("idle", "READY", "Your command center. Speak or type to begin.");
  }
  function submitVoiceTranscript() {
    const transcript = voiceFinalTranscript.trim();
    if (!transcript || busy || voiceSubmissionPending) return;
    clearTimeout(voiceSendTimer);
    voiceSendTimer = null;
    voiceFinalTranscript = "";
    voiceSubmissionPending = true;
    stopListening();
    sendMessage(transcript).finally(() => {
      voiceSubmissionPending = false;
    });
  }
  function setupRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      micButton.disabled = true;
      handsFreeButton.disabled = true;
      handsFreeButton.textContent = "Voice unavailable";
      micLabel.textContent = "Use keyboard dictation";
      voiceHint.textContent = "This browser does not expose speech recognition. On iPhone, tap the keyboard microphone and dictate into the message box.";
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = "hi-IN";
    recognition.maxAlternatives = 3;
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onstart = () => {
      recognitionStarting = false;
      recognitionBlocked = false;
      listening = true;
      micLabel.textContent = handsFree ? "Listening for “JOMY”…" : "Listening… tap to stop";
      micButton.setAttribute("aria-label", "Stop voice input");
      setState("listening", handsFree ? "HANDS-FREE" : "LISTENING", handsFree ? "Say JOMY to wake me, then speak your command." : "I'm listening. Say your command.");
    };
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      const finalCandidates = [];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += (finalText ? " " : "") + event.results[i][0].transcript;
          for (let j = 0; j < event.results[i].length; j++) {
            finalCandidates.push(event.results[i][j].transcript);
          }
        } else {
          interimText += event.results[i][0].transcript;
        }
      }
      if (!handsFree) {
        if (finalText) {
          voiceFinalTranscript = [voiceFinalTranscript, finalText].filter(Boolean).join(" ").trim();
          messageInput.value = voiceFinalTranscript;
          if (!busy && !voiceSubmissionPending) {
            clearTimeout(voiceSendTimer);
            voiceSendTimer = setTimeout(() => submitVoiceTranscript(), 900);
          }
        } else if (!voiceFinalTranscript) {
          messageInput.value = interimText;
        }
        return;
      }
      if (!finalText) return;
      const command = parseWakeCommand(finalText, finalCandidates, waitingForCommand);
      if (command === null) return;
      if (!command) {
        wakeActivityBoard();
        waitingForCommand = true;
        try { recognition.stop(); } catch (_) {}
        listening = false;
        speak("हाँ, बोलिए।");
        return;
      }
      waitingForCommand = false;
      if (/^(stop listening|stop|बंद करो|सुनना बंद करो|सुनना रोको)$/i.test(command.trim())) {
        stopHandsFree();
        return;
      }
      try { recognition.stop(); } catch (_) {}
      listening = false;
      sendMessage(command);
    };
    recognition.onerror = (event) => {
      recognitionStarting = false;
      listening = false;
      const fatalVoiceErrors = ["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported", "network"];
      if (fatalVoiceErrors.includes(event.error)) recognitionBlocked = true;
      micLabel.textContent = handsFree ? "Hands-free paused" : "Tap to speak";
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        micLabel.textContent = "Tap anywhere to retry";
        voiceHint.textContent = "Allow microphone access for this website in iPhone Settings or Safari, then tap Hands-free once to retry.";
        setState("idle", "MIC PERMISSION", "Allow microphone access, then tap to retry.");
      } else {
        const message = event.error === "audio-capture"
          ? "No microphone was found. Check iPhone microphone access."
          : event.error === "network"
            ? "Speech recognition network is unavailable. Check your connection."
            : event.error === "no-speech"
              ? "No speech detected. Say JOMY and try again."
              : "Voice input paused (" + event.error + "). Tap the microphone to retry.";
        voiceHint.textContent = message;
        setState("idle", "VOICE PAUSED", message);
      }
    };
    recognition.onend = () => {
      recognitionStarting = false;
      listening = false;
      if (!handsFree && voiceFinalTranscript && !voiceSubmissionPending) {
        clearTimeout(voiceSendTimer);
        voiceSendTimer = setTimeout(() => submitVoiceTranscript(), 250);
      }
      if (handsFree && !recognitionBlocked && !busy && !speakingReply && !(window.speechSynthesis && window.speechSynthesis.speaking)) {
        startRecognition();
      } else if (!handsFree && !busy && !voiceFinalTranscript && orbStage.dataset.state === "listening") {
        micLabel.textContent = "Tap to speak";
        setState("idle", "READY", "Your command center. Speak or type to begin.");
      }
    };
  }
  async function callMcp(action, extra = {}) {
    if (!endpoint || !ownerToken || !mcpClientToken) throw new Error("Settings mein Agent endpoint, Agent owner token aur JOMY MCP Client token set karo.");
    const mcpEndpoint = endpoint.replace(/\/api\/agent\/chat\/?$/, "/api/agent/mcp");
    if (mcpEndpoint === endpoint) throw new Error("Agent API URL ka path /api/agent/chat hona chahiye.");
    const response = await fetch(mcpEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ownerToken },
      body: JSON.stringify({ action, mcpToken: mcpClientToken, ...extra })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "MCP request failed (HTTP " + response.status + ").");
    return data;
  }

  async function testMcpConnection() {
    const previous = $("testMcpConnection").textContent;
    $("testMcpConnection").disabled = true;
    $("testMcpConnection").textContent = "Testing…";
    try {
      endpoint = endpointInput.value.trim();
      ownerToken = agentTokenInput.value.trim();
      mcpClientToken = mcpTokenInput.value.trim();
      if (ownerToken) sessionStorage.setItem(STORAGE_TOKEN, ownerToken);
      if (mcpClientToken) sessionStorage.setItem(STORAGE_MCP_TOKEN, mcpClientToken);
      const data = await callMcp("status");
      const server = data.system?.status || "unknown";
      const telegram = data.telegram?.configured ? "configured" : "not configured";
      $("settingsNote").textContent = "MCP connected · Server: " + server + " · Telegram: " + telegram + ".";
      setConnection(true, "MCP Connected");
    } catch (error) {
      $("settingsNote").textContent = error.message;
      setConnection(false, "MCP not connected");
    } finally {
      $("testMcpConnection").disabled = false;
      $("testMcpConnection").textContent = previous;
    }
  }

  async function sendMessage(rawText) {
    const text = rawText.trim();
    if (!text || busy) return;
    addMessage("user", text);
    messageInput.value = "";
    messageInput.style.height = "auto";
    const telegramText = extractTelegramMessage(text);
    if (telegramText) {
      busy = true;
      $("sendButton").disabled = true;
      setState("thinking", "PREPARING TELEGRAM", "Creating an approval request. Nothing will be sent yet.");
      try {
        const prepared = await callMcp("prepare_telegram", { text: telegramText });
        const notice = "Telegram request prepared. Nothing was sent. Approval ID: " + prepared.approvalId + ". Open JOMY MCP Owner Admin and approve this exact request before the message is sent.";
        addMessage("agent", notice);
        speak(notice);
        setConnection(true, "MCP Connected");
      } catch (error) {
        const notice = "Telegram request was not prepared: " + error.message + ". No message was sent.";
        addMessage("agent", notice);
        speak(notice);
        setConnection(false, "MCP connection issue");
      } finally {
        busy = false;
        $("sendButton").disabled = false;
        if (handsFree && !listening && !(window.speechSynthesis && window.speechSynthesis.speaking)) startRecognition();
      }
      return;
    }
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
        body: JSON.stringify({ message: text, history: conversationHistory.slice(0, -1).slice(-10), sessionId, locale: "hi-IN", client: "jomy-autonomous-agent" })
      });
      if (!response.ok) {
        let detail = "Agent endpoint returned HTTP " + response.status;
        try {
          const errorData = await response.json();
          if (typeof errorData.error === "string") detail = errorData.error;
        } catch (_) {}
        throw new Error(detail);
      }
      const data = await response.json();
      const reply = typeof data.reply === "string" ? data.reply : typeof data.message === "string" ? data.message : "";
      if (!reply) throw new Error("The agent response did not include a reply string.");
      addMessage("agent", reply);
      speak(reply);
      setConnection(true, "Connected");
    } catch (error) {
      const notice = "Connection problem: " + error.message + ". No task was confirmed as completed.";
      addMessage("agent", notice);
      speak(notice);
      setState("idle", "CONNECTION ISSUE", "Check your API URL and server status.");
      setConnection(false, "Connection error");
    } finally {
      busy = false;
      $("sendButton").disabled = false;
      if (orbStage.dataset.state === "thinking") setState("idle", handsFree ? "HANDS-FREE ACTIVE" : "READY", handsFree ? "Say JOMY, then give your command." : "Your command center. Speak or type to begin.");
      if (handsFree && !listening && !(window.speechSynthesis && window.speechSynthesis.speaking)) startRecognition();
    }
  }

  renderTaskQueue();
  setupRecognition();
  setConnection(false, endpoint ? "Endpoint saved · not tested" : "Not connected");
  handsFreeButton.textContent = handsFree ? "Hands-free: On" : "Hands-free: Off";
  handsFreeButton.setAttribute("aria-pressed", String(handsFree));
  if (handsFree) {
    voiceHint.textContent = "Tap Hands-free once to start. Say “JOMY”, wait for “हाँ, बोलिए”, then speak your command. Keep this page open; iPhone may pause listening in the background or when locked.";
    startRecognition();
  }
  soundButton.setAttribute("aria-pressed", String(soundOn));
  soundButton.textContent = soundOn ? "◖))" : "◖×";
  micButton.addEventListener("click", () => {
    unlockSpeech();
    if (!recognition) return;
    if (handsFree) stopHandsFree();
    else if (listening) stopListening();
    else {
      recognitionBlocked = false;
      recognitionStarting = true;
      try { recognition.start(); } catch (_) { recognitionStarting = false; setState("idle", "MIC PAUSED", "Wait a moment, then tap to retry."); }
    }
  });
  handsFreeButton.addEventListener("click", () => {
    unlockSpeech();
    if (!recognition) return;
    if (handsFree && listening) {
      stopHandsFree();
      return;
    }
    if (handsFree && !listening) {
      recognitionBlocked = false;
      startRecognition();
      return;
    }
    handsFree = true;
    recognitionBlocked = false;
    localStorage.setItem(STORAGE_HANDSFREE, "true");
    waitingForCommand = false;
    handsFreeButton.textContent = "Hands-free: On";
    handsFreeButton.setAttribute("aria-pressed", "true");
    voiceHint.textContent = "Keep JOMY open in the foreground. Say “JOMY”, wait for “हाँ, बोलिए”, then speak. Say “Stop listening” to turn it off. iPhone may pause listening when Safari is backgrounded or the screen locks.";
    startRecognition();
  });
  soundButton.addEventListener("click", () => {
    soundOn = !soundOn;
    if (soundOn) unlockSpeech();
    localStorage.setItem(STORAGE_SOUND, String(soundOn));
    soundButton.setAttribute("aria-pressed", String(soundOn));
    soundButton.textContent = soundOn ? "◖))" : "◖×";
    if (!soundOn && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      speakingReply = false;
      if (handsFree) startRecognition();
    }
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
    mcpTokenInput.value = mcpClientToken;
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
      mcpClientToken = mcpTokenInput.value.trim();
      localStorage.setItem(STORAGE_ENDPOINT, endpoint);
      if (ownerToken) sessionStorage.setItem(STORAGE_TOKEN, ownerToken);
      else sessionStorage.removeItem(STORAGE_TOKEN);
      if (mcpClientToken) sessionStorage.setItem(STORAGE_MCP_TOKEN, mcpClientToken);
      else sessionStorage.removeItem(STORAGE_MCP_TOKEN);
      setConnection(false, "Endpoint saved · not tested");
      $("settingsNote").textContent = "Saved on this device. Send a message to test the connection.";
    } catch (error) {
      $("settingsNote").textContent = error.message || "Enter a valid HTTPS URL.";
    }
  });
  $("testMcpConnection").addEventListener("click", testMcpConnection);
  $("clearEndpoint").addEventListener("click", () => {
    endpoint = "";
    localStorage.removeItem(STORAGE_ENDPOINT);
    endpointInput.value = "";
    ownerToken = "";
    mcpClientToken = "";
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