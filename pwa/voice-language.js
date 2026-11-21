// User-selected browser voice language. Does not start the microphone.
export const VOICE_LANGUAGE_KEY = "jomy_voice_language_v1";
export const DEFAULT_VOICE_LANGUAGE = "hi-IN";
export function normalizeVoiceLanguage(value) {
  return value === "en-IN" ? "en-IN" : DEFAULT_VOICE_LANGUAGE;
}
export function voiceAvailabilityMessage({speechRecognition=false,speechSynthesis=false,lang=DEFAULT_VOICE_LANGUAGE}={}) {
  if (!speechRecognition) return "Speech input unavailable here. Use the iPhone keyboard microphone or text chat.";
  if (!speechSynthesis) return "Speech input available; spoken replies unavailable on this browser.";
  return normalizeVoiceLanguage(lang)==="en-IN"
    ? "English (India) selected. Voice is opt-in and works only while this page stays in the foreground."
    : "Hindi / Hinglish selected. Voice is opt-in and works only while this page stays in the foreground.";
}
