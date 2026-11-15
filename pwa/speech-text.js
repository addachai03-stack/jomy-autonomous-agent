export function prepareSpeechText(input) {
  let text = String(input ?? "");
  text = text
    .replace(/\x60{3}[\s\S]*?\x60{3}/g, " ")
    .replace(/\x60([^\x60]+)\x60/g, "$1")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bAap\b/gi, "आप")
    .replace(/\bJOMY\b/gi, "जोमी");

  // Remove emoji presentation/keycap joiners before applying the speech allowlist.
  text = text
    .replace(/[#*0-9]\uFE0F?\u20E3/gu, " ")
    .replace(/[\uFE0E\uFE0F\u200D\u20E3]/gu, " ");

  // Keep only spoken words, numbers and natural pause punctuation.
  // URLs, code, emoji and decorative symbols are not spoken.
  const cleaned = text
    .replace(/[^\p{L}\p{N}\p{M}\s,.;?!।]/gu, " ")
    .replace(/[!?]{2,}/gu, "!")
    .replace(/\.{2,}/gu, ".")
    .replace(/[,;]{2,}/gu, ",")
    .replace(/\s+([,.;?!।])/gu, "$1")
    .replace(/([,;?!।])(?=\S)/gu, "$1 ")
    .replace(/\s+/gu, " ")
    .trim();

  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : "";
}
