import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

// All requests below are fake in-process Requests. No live API, secrets,
// accounts, Cloudflare resources, AI inference or external calls are used.
const origin = 'https://owner.example';
const url = 'https://jomy.example/api/agent/chat';
const env = { ALLOWED_ORIGIN: origin, AGENT_OWNER_TOKEN: 'local-test-placeholder' };

test('health is non-cached and never reveals the token', async () => {
  const res = await worker.fetch(new Request('https://jomy.example/health'), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.text();
  assert.ok(!body.includes(env.AGENT_OWNER_TOKEN));
  assert.equal(JSON.parse(body).ownerAuthConfigured, true);
});

test('chat rejects missing bearer token without calling AI', async () => {
  const req = new Request(url, {
    method: 'POST', headers: { 'Origin': origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hello' })
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('access-control-allow-origin'), origin);
});

test('chat refuses a foreign browser origin before authentication', async () => {
  const req = new Request(url, {
    method: 'POST',
    headers: {
      'Origin': 'https://attacker.example',
      'Authorization': 'Bearer ' + env.AGENT_OWNER_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message: 'hello' })
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('CORS preflight allows owner origin but rejects another', async () => {
  for (const [requestOrigin, status] of [
    [origin, 204],
    ['https://attacker.example', 403]
  ]) {
    const req = new Request(url, { method: 'OPTIONS', headers: { 'Origin': requestOrigin } });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, status);
    assert.equal(res.headers.get('access-control-allow-origin'),
      status === 204 ? origin : null);
  }
});

test('large authenticated JSON is blocked before model inference', async () => {
  const req = new Request(url, {
    method: 'POST',
    headers: {
      'Origin': origin,
      'Authorization': 'Bearer ' + env.AGENT_OWNER_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({message:'a'.repeat(20_000)})
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 413);
});
