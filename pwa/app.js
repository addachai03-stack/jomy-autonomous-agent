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
  const settingsDialog = $("settingsDialog");
  const endpointInput = $("endpointInput");
  const agentTokenInput = $("agentTokenInput");
  const connection = $("connection");
  const voiceHint = $("voiceHint");
  const STORAGE_ENDPOINT = "jomy_agent_endpoint_v1";
  const STORAGE_SOUND = "jomy_agent_sound_v1";
  const STORAGE_HANDSFREE = "jomy_agent_handsfree_v1";
  const STORAGE_TOKEN = "jomy_agent_owner_token_v1";
  let endpoint = localStorage.getItem(STORAGE_ENDPOINT) || "";
  let ownerToken = sessionStorage.getItem(STORAGE_TOKEN) || "";
  let soundOn = localStorage.getItem(STORAGE_SOUND) !== "false";
  let recognition = null;
  let listening = false;
  let handsFree = localStorage.getItem(STORAGE_HANDSFREE) !== "false";
  let waitingForCommand = false;
  let busy = false;
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
    if (!soundOn || !("speechSynthesis" in window)) {
      if (handsFree) startRecognition();
      return;
    }
    if (recognition && listening) {
      try { recognition.stop(); } catch (_) {}
      listening = false;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "hi-IN";
    utterance.rate = 1;
    utterance.onstart = () => setState("speaking", "SPEAKING", "JOMY is replying.");
    utterance.onend = () => {
      setState("idle", handsFree ? "HANDS-FREE ACTIVE" : "READY", handsFree ? "Say JOMY, then give your command." : "Your command center. Speak or type to begin.");
      if (handsFree) startRecognition();
    };
    window.speechSynthesis.speak(utterance);
  }
  function startRecognition() {
    if (!recognition || !handsFree || busy || listening) return;
    try { recognition.start(); }
    catch (_) {
      if (handsFree) {
        micLabel.textContent = "Tap anywhere to activate";
        voiceHint.textContent = "Hands-free is ready. Tap anywhere once to let iPhone Safari start the microphone, then keep JOMY in the foreground.";
        setState("idle", "READY TO ACTIVATE", "Tap anywhere once to start hands-free listening.");
      }
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
        messageInput.value = finalText || interimText;
        if (finalText) {
          stopListening();
          messageInput.focus();
        }
        return;
      }
      if (!finalText) return;
      // iOS Hindi dictation often renders “JOMY” as only “जो”.
      // Accept common Hindi, English and Hinglish wake-word renderings.
      const wakePattern = /(?:^|[\s,])(?:hey\s*)?(?:jomy|jo\s*my|jomi|jo|जोमी|जो\s*मी|जॉमी|ज्योमी)(?=$|[\s,.!?])/i;
      const wakeCandidate = finalCandidates.find((candidate) => wakePattern.test(candidate)) || "";
      if (!waitingForCommand && !wakeCandidate) return;
      const sourceText = wakeCandidate || finalText;
      let command = waitingForCommand ? finalText.trim() : sourceText.replace(wakePattern, "").replace(/^[\s,!.]+/, "").trim();
      if (!command) {
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
      listening = false;
      micLabel.textContent = handsFree ? "Hands-free paused" : "Tap to speak";
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        micLabel.textContent = "Tap anywhere to retry";
        voiceHint.textContent = "Allow microphone access for this website in iPhone Settings or Safari, then tap anywhere to retry hands-free.";
        setState("idle", "MIC PERMISSION", "Microphone permission is needed. Tap anywhere after allowing it.");
      } else if (!handsFree) {
        setState("idle", "MIC ISSUE", "Voice input stopped. You can type your command.");
      }
    };
    recognition.onend = () => {
      listening = false;
      if (handsFree && !busy && !(window.speechSynthesis && window.speechSynthesis.speaking)) {
        startRecognition();
      } else if (!handsFree && !busy && orbStage.dataset.state === "listening") {
        micLabel.textContent = "Tap to speak";
        setState("idle", "READY", "Your command center. Speak or type to begin.");
      }
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
      if (!response.ok) throw new Error("Agent endpoint returned HTTP " + response.status);
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

  setupRecognition();
  setConnection(false, endpoint ? "Endpoint saved · not tested" : "Not connected");
  handsFreeButton.textContent = handsFree ? "Hands-free: On" : "Hands-free: Off";
  handsFreeButton.setAttribute("aria-pressed", String(handsFree));
  if (handsFree) {
    voiceHint.textContent = "Hands-free starts automatically when Safari allows it. If iPhone blocks startup, tap anywhere once. Keep JOMY open in the foreground.";
    startRecognition();
  }
  document.addEventListener("pointerdown", () => {
    if (handsFree && !listening && !busy && !(window.speechSynthesis && window.speechSynthesis.speaking)) startRecognition();
  }, { capture: true, passive: true });
  soundButton.setAttribute("aria-pressed", String(soundOn));
  soundButton.textContent = soundOn ? "◖))" : "◖×";
  micButton.addEventListener("click", () => {
    if (!recognition) return;
    if (handsFree) stopHandsFree();
    else if (listening) stopListening();
    else {
      try { recognition.start(); } catch (_) { setState("idle", "MIC BUSY", "Wait a moment, then try again."); }
    }
  });
  handsFreeButton.addEventListener("click", () => {
    if (!recognition) return;
    if (handsFree) {
      localStorage.setItem(STORAGE_HANDSFREE, "false");
      stopHandsFree();
      return;
    }
    handsFree = true;
    localStorage.setItem(STORAGE_HANDSFREE, "true");
    waitingForCommand = false;
    handsFreeButton.textContent = "Hands-free: On";
    handsFreeButton.setAttribute("aria-pressed", "true");
    voiceHint.textContent = "Keep JOMY open in the foreground. Say “JOMY”, wait for “हाँ, बोलिए”, then speak. Say “Stop listening” to turn it off. iPhone may pause listening when Safari is backgrounded or the screen locks.";
    startRecognition();
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