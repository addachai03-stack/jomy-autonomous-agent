export function prepareSpeechText(input) {
  let text = String(input ?? "");
  text = text
    .replace(/```[\\s\\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\[([^\\]]+)\\]\\((?:https?:\\/\\/)?[^)]+\\)/g, "$1")
    .replace(/https?:\\/\\/\\S+/gi, " link ")
    // Convert common Roman-Hindi words that browser voices tend to spell out.
    .replace(/\\bAap\\b/gi, "आप")
    .replace(/\\bJOMY\\b/gi, "जोमी")
    // Remove complete emoji sequences, including flags, skin tones and keycaps.
    .replace(/(?:\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)*)|(?:\\p{Regional_Indicator}{2})|(?:[#*0-9]\\uFE0F?\\u20E3)|\\p{Emoji_Modifier}|[\\u{E0020}-\\u{E007F}]/gu, " ")
    .replace(/[\\uFE0E\\uFE0F\\u200D\\u20E3\\p{Cf}]/gu, " ")
    .replace(/[\\p{P}\\p{S}]/gu, " ")
    .replace(/\\s+/g, " ")
    .trim();
  return text;
}
