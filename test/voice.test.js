import test from "node:test";
import assert from "node:assert/strict";
import { parseWakeCommand } from "../pwa/voice-utils.js";

test("extracts a command spoken after the English wake word", () => {
  assert.equal(parseWakeCommand("JOMY, open my notes"), "open my notes");
});

test("extracts a command spoken after Hindi wake-word variants", () => {
  assert.equal(parseWakeCommand("जॉमी मौसम बताओ"), "मौसम बताओ");
  assert.equal(parseWakeCommand("जो मी मुझे याद दिलाना"), "मुझे याद दिलाना");
});

test("uses the alternative transcript that contains the wake word", () => {
  assert.equal(
    parseWakeCommand("मेरा अलार्म लगाओ", ["मेरा अलार्म लगाओ", "JOMY मेरा अलार्म लगाओ"]),
    "मेरा अलार्म लगाओ"
  );
});

test("returns an empty command when only the wake word was spoken", () => {
  assert.equal(parseWakeCommand("Hey JOMY"), "");
});

test("does not wake on the common standalone Hindi word jo", () => {
  assert.equal(parseWakeCommand("जो करना है करो"), null);
});

test("accepts the follow-up command after the wake prompt", () => {
  assert.equal(parseWakeCommand("अब मौसम बताओ", [], true), "अब मौसम बताओ");
});


test("extracts explicit English and Hinglish Telegram send commands", async () => {
  const { extractTelegramMessage } = await import("../pwa/voice-utils.js");
  assert.equal(extractTelegramMessage("Telegram par bhejo: Hello from JOMY"), "Hello from JOMY");
  assert.equal(extractTelegramMessage("send this on Telegram: Meeting at 5"), "Meeting at 5");
});

test("extracts Hindi Telegram send commands and ignores ambiguous text", async () => {
  const { extractTelegramMessage } = await import("../pwa/voice-utils.js");
  assert.equal(extractTelegramMessage("टेलीग्राम पर भेजो: नमस्ते"), "नमस्ते");
  assert.equal(extractTelegramMessage("मुझे Telegram के बारे में बताओ"), null);
  assert.equal(extractTelegramMessage("Telegram par bhejo"), null);
});
