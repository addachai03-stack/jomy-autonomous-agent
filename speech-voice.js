const FEMALE_NAME_HINTS = /\b(lekha|aditi|raveena|heera|priya|neerja|sangeeta|kavya|female)\b/i;
const QUALITY_HINTS = /premium|enhanced|natural|compact|siri/i;

export function selectHindiFemaleVoice(voices = []) {
  const hindiVoices = Array.from(voices || []).filter((voice) =>
    voice && typeof voice.lang === "string" && /^hi([-_]|$)/i.test(voice.lang)
  );
  if (!hindiVoices.length) return null;

  return hindiVoices.sort((a, b) => {
    const score = (voice) =>
      (/^hi[-_]in$/i.test(voice.lang) ? 100 : 0) +
      (FEMALE_NAME_HINTS.test(voice.name || "") ? 50 : 0) +
      (QUALITY_HINTS.test(voice.name || "") ? 10 : 0) +
      (voice.localService ? 2 : 0);
    return score(b) - score(a);
  })[0];
}
