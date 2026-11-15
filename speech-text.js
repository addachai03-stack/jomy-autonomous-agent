export function prepareSpeechText(input) {
  let text = String(input ?? "");
  text = text
    .replace(/\x60{3}[\s\S]*?\x60{3}/g, " ")
    .replace(/\x60([^\x60]+)\x60/g, "$1")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " link ")
    .replace(/\bAap\b/gi, "आप")
    .replace(/\bJOMY\b/gi, "जोमी");

  // Remove emoji presentation/keycap joiners before applying the speech allowlist.
  text = text
    .replace(/[#*0-9]\uFE0F?\u20E3/gu, " ")
    .replace(/[\uFE0E\uFE0F\u200D\u20E3]/gu, " ");

  // Retain letters (including Indic scripts), numbers, combining marks and
  // whitespace only. Emoji, symbols, punctuation and invisible format
  // characters never reach the device's speech engine.
  return text
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
