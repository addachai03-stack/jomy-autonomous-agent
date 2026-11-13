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
