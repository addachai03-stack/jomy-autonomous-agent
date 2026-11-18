import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const pwaDir = dirname(fileURLToPath(new URL("../pwa/index.html", import.meta.url)));
const appSource = readFileSync(join(pwaDir, "app.js"), "utf8");
const swSource = readFileSync(join(pwaDir, "sw.js"), "utf8");
const html = readFileSync(join(pwaDir, "index.html"), "utf8");

test("all PWA application imports exist in deployed asset directory", () => {
  const imports = [...appSource.matchAll(/^import\s+.*?\s+from\s+"\.\/(.+?)";/gm)];
  assert.ok(imports.length >= 6, "App must have expected static imports");
  for (const [, file] of imports) {
    assert.ok(existsSync(join(pwaDir, file)), `Missing PWA import: ${file}`);
  }
});

test("service worker precache contains no missing files", () => {
  const array = swSource.match(/const ASSETS = (\[[^;]+\]);/);
  assert.ok(array, "PWA precache list must exist");
  const paths = JSON.parse(array[1]);
  for (const asset of paths) {
    if (asset === "/") continue;
    const pathname = new URL(asset, "https://jomy.local").pathname; // ignore version ?v= query
    assert.ok(existsSync(join(pwaDir, pathname.slice(1))), `Missing precache asset: ${asset}`);
  }
});

test("iPhone Send gesture primes spoken reply and voice test is available", () => {
  assert.match(appSource, /chatForm\.addEventListener\("submit", \(event\) => \{\s*event\.preventDefault\(\);[\s\S]*?unlockSpeech\(\);[\s\S]*?sendMessage\(messageInput\.value\)/);
  assert.match(html, /id="testVoiceButton"/);
  assert.match(html, /new SpeechSynthesisUtterance\("नमस्ते/);
});
