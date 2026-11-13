export function parseWakeCommand(finalText, finalCandidates = [], waitingForCommand = false) {
  const primary = typeof finalText === "string" ? finalText.trim() : "";
  if (waitingForCommand) return primary;
  const wakePattern = /(?:^|[\s,])(?:hey\s*)?(?:jomy|jo\s*my|jomi|जोमी|जो\s*मी|जॉमी|ज्योमी)(?=$|[\s,.!?])/i;
  const transcript = wakePattern.test(primary)
    ? primary
    : finalCandidates.find((candidate) => typeof candidate === "string" && wakePattern.test(candidate)) || "";
  if (!transcript) return null;
  return transcript.replace(wakePattern, "").replace(/^[\s,!.]+/, "").trim();
}
