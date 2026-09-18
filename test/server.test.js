const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createApp } = require('../server');

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'be-there-'));
  const dataFile = path.join(directory, 'data.json');
  const app = createApp({ dataFile, redis: null, adminPassword: 'test-secret' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => app.server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { origin, dataFile };
}

test('increments once per socket address and ignores spoofed forwarding headers', async t => {
  const { origin } = await fixture(t);
  const first = await fetch(`${origin}/api/increment`, { method: 'POST', headers: { 'x-forwarded-for': '1.1.1.1' } }).then(r => r.json());
  const second = await fetch(`${origin}/api/increment`, { method: 'POST', headers: { 'x-forwarded-for': '2.2.2.2' } }).then(r => r.json());
  assert.equal(first.count, 1);
  assert.equal(second.count, 1);
});

test('handles concurrent increments without losing deduplication state', async t => {
  const { origin, dataFile } = await fixture(t);
  await Promise.all(Array.from({ length: 20 }, () => fetch(`${origin}/api/increment`, { method: 'POST' })));
  const state = await fetch(`${origin}/api/state`).then(r => r.json());
  const stored = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.equal(state.count, 1);
  assert.equal(stored.ips.length, 1);
});

test('admin authentication updates text, safely serves it, and resets count', async t => {
  const { origin } = await fixture(t);
  await fetch(`${origin}/api/increment`, { method: 'POST' });
  const eventText = '</script><script>globalThis.pwned=true</script>';
  const response = await fetch(`${origin}/api/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-secret', eventText, resetCount: true })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { count: 0, eventText });
  const html = await fetch(origin).then(r => r.text());
  assert.doesNotMatch(html, /globalThis\.pwned/);
  assert.equal((await fetch(`${origin}/api/state`).then(r => r.json())).eventText, eventText);
});

test('admin can set an exact attendance count', async t => {
  const { origin } = await fixture(t);
  const response = await fetch(`${origin}/api/admin`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-secret', count: 42 })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).count, 42);
  assert.equal((await fetch(`${origin}/api/state`).then(r => r.json())).count, 42);
});

test('supports asset query strings and blocks path traversal', async t => {
  const { origin } = await fixture(t);
  assert.equal((await fetch(`${origin}/styles.css?v=1`)).status, 200);
  assert.notEqual((await fetch(`${origin}/..%2fpackage.json`)).status, 200);
});

test('rejects oversized request bodies', async t => {
  const { origin } = await fixture(t);
  const response = await fetch(`${origin}/api/admin`, { method: 'POST', body: 'x'.repeat(20 * 1024) });
  assert.equal(response.status, 413);
});

// A minimal in-memory stand-in for the handful of Redis commands the server uses.
function fakeRedis() {
  const strings = new Map();
  const sets = new Map();
  const hashes = new Map();
  const client = {
    async get(key) { return strings.has(key) ? strings.get(key) : null; },
    async set(key, value) { strings.set(key, String(value)); return 'OK'; },
    async del(key) { strings.delete(key); sets.delete(key); hashes.delete(key); return 1; },
    async sismember(key, member) { return sets.get(key)?.has(member) ? 1 : 0; },
    async hget(key, field) { return hashes.get(key)?.get(field) ?? null; },
    async hincrby(key, field, by) {
      if (!hashes.has(key)) hashes.set(key, new Map());
      const next = Number(hashes.get(key).get(field) || 0) + by;
      hashes.get(key).set(field, String(next));
      return next;
    },
    async eval(_script, _numKeys, countKey, ipsKey, extraKey, ip) {
      if (!sets.has(ipsKey)) sets.set(ipsKey, new Set());
      const members = sets.get(ipsKey);
      if (members.has(ip)) return [Number(strings.get(countKey) || 0), await client.hincrby(extraKey, ip, 1)];
      members.add(ip);
      const next = Number(strings.get(countKey) || 0) + 1;
      strings.set(countKey, String(next));
      return [next, 0];
    },
    multi() {
      const queue = [];
      const batch = {
        set: (k, v) => { queue.push(() => client.set(k, v)); return batch; },
        del: k => { queue.push(() => client.del(k)); return batch; },
        exec: async () => { for (const op of queue) await op(); return []; }
      };
      return batch;
    }
  };
  return client;
}

test('keeps count and event text in redis when it is available', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'be-there-'));
  const redis = fakeRedis();
  const app = createApp({ dataFile: path.join(directory, 'data.json'), redis, adminPassword: 'test-secret' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => app.server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await fetch(`${origin}/api/increment`, { method: 'POST' });
  await fetch(`${origin}/api/admin`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-secret', eventText: 'Malott 103, 11am' })
  });
  assert.equal(await redis.get('be-there:count'), '1');
  assert.equal(await redis.get('be-there:count:text'), 'Malott 103, 11am');

  // A fresh app instance with an empty data file (as after a redeploy) still sees the shared state.
  const fresh = createApp({ dataFile: path.join(directory, 'fresh.json'), redis, adminPassword: 'test-secret' });
  await new Promise(resolve => fresh.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => fresh.server.close(resolve)));
  const state = await fetch(`http://127.0.0.1:${fresh.server.address().port}/api/state`).then(r => r.json());
  assert.deepEqual(state, { count: 1, eventText: 'Malott 103, 11am', clicked: true, extraClicks: 0 });
});

test('remembers forbidden repeat clicks per IP and clears them on reset', async t => {
  const { origin } = await fixture(t);
  const first = await fetch(`${origin}/api/increment`, { method: 'POST' }).then(r => r.json());
  assert.deepEqual(first, { count: 1, clicked: true, extraClicks: 0 });
  await fetch(`${origin}/api/increment`, { method: 'POST' });
  const third = await fetch(`${origin}/api/increment`, { method: 'POST' }).then(r => r.json());
  assert.deepEqual(third, { count: 1, clicked: true, extraClicks: 2 });
  assert.equal((await fetch(`${origin}/api/state`).then(r => r.json())).extraClicks, 2);

  await fetch(`${origin}/api/admin`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-secret', resetCount: true })
  });
  assert.deepEqual(await fetch(`${origin}/api/state`).then(r => r.json()), { count: 0, eventText: 'Event Text', clicked: false, extraClicks: 0 });
});
