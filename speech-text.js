const emojiCodePoint = /[\p{Emoji}\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}]/u;

function removeEmojiCharacters(value) {
  // Remove complete keycap sequences before preserving ordinary ASCII digits.
  value = value.replace(/[#*0-9]\uFE0F?\u20E3/gu, " ");
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0);
    // ASCII digits and keycap bases are ordinary spoken numbers here.
    if ((codePoint >= 0x30 && codePoint <= 0x39) || codePoint === 0x23 || codePoint === 0x2a) {
      return character;
    }
    if (
      emojiCodePoint.test(character) ||
      codePoint === 0xfe0e ||
      codePoint === 0xfe0f ||
      codePoint === 0x200d ||
      codePoint === 0x20e3 ||
      (codePoint >= 0xe0020 && codePoint <= 0xe007f)
    ) {
      return " ";
    }
    return character;
  }).join("");
}

export function prepareSpeechText(input) {
  let text = String(input ?? "");
  text = text
    .replace(/\x60{3}[\s\S]*?\x60{3}/g, " ")
    .replace(/\x60([^\x60]+)\x60/g, "$1")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " link ")
    .replace(/\bAap\b/gi, "आप")
    .replace(/\bJOMY\b/gi, "जोमी");
  text = removeEmojiCharacters(text);
  text = text
    .replace(/[\uFE0E\uFE0F\u200D\u20E3\p{Cf}]/gu, " ")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}
