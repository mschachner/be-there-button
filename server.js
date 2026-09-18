const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const RedisLib = (() => { try { return require('ioredis'); } catch (_) { return null; } })();

const DEFAULT_DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 16 * 1024;
const MAX_EVENT_TEXT = 500;
const REDIS_TIMEOUT_MS = 500;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;

function createApp(options = {}) {
  const dataFile = options.dataFile || DEFAULT_DATA_FILE;
  const redis = options.redis === undefined ? createRedisClient() : options.redis;
  const redisKey = process.env.REDIS_KEY || 'be-there:count';
  const redisIpsKey = `${redisKey}:ips`;
  const redisTextKey = `${redisKey}:text`;
  const adminPassword = options.adminPassword || process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY === 'true';
  const loginFailures = new Map();
  let fileMutation = Promise.resolve();

  ensureDataFile(dataFile);

  function mutateFile(mutator) {
    const operation = fileMutation.then(() => {
      const next = mutator(readDataFile(dataFile));
      writeDataFile(dataFile, next);
      return next;
    });
    fileMutation = operation.catch(() => {});
    return operation;
  }

  async function getState(ip) {
    const fileData = readDataFile(dataFile);
    if (!redis) return { count: fileData.count, eventText: fileData.eventText, clicked: fileData.ips.includes(ip) };
    try {
      const [countValue, clickedValue, textValue] = await withTimeout(
        Promise.all([redis.get(redisKey), redis.sismember(redisIpsKey, ip), redis.get(redisTextKey)]),
        REDIS_TIMEOUT_MS
      );
      const parsed = Number.parseInt(countValue ?? String(fileData.count), 10);
      return {
        count: Number.isFinite(parsed) ? parsed : fileData.count,
        eventText: typeof textValue === 'string' ? textValue.slice(0, MAX_EVENT_TEXT) : fileData.eventText,
        clicked: Boolean(clickedValue)
      };
    } catch (err) {
      logError('Redis state read failed; using file fallback', err);
      return { count: fileData.count, eventText: fileData.eventText, clicked: fileData.ips.includes(ip) };
    }
  }

  async function addIp(ip) {
    if (redis) {
      try {
        const count = await withTimeout(redis.eval(
          "if redis.call('SADD', KEYS[2], ARGV[1]) == 1 then return redis.call('INCR', KEYS[1]) else return tonumber(redis.call('GET', KEYS[1]) or '0') end",
          2, redisKey, redisIpsKey, ip
        ), REDIS_TIMEOUT_MS);
        await mutateFile(data => ({ ...data, count: Number(count), ips: data.ips.includes(ip) ? data.ips : [...data.ips, ip] }));
        return Number(count);
      } catch (err) {
        logError('Redis increment failed; using file fallback', err);
      }
    }
    return (await mutateFile(data => data.ips.includes(ip) ? data : ({ ...data, count: data.count + 1, ips: [...data.ips, ip] }))).count;
  }

  async function updateAdminState(eventText, requestedCount) {
    const countChanged = requestedCount !== undefined;
    const textChanged = eventText !== undefined;
    if (redis && (countChanged || textChanged)) {
      try {
        const batch = redis.multi();
        if (countChanged) batch.set(redisKey, String(requestedCount)).del(redisIpsKey);
        if (textChanged) batch.set(redisTextKey, eventText);
        await withTimeout(batch.exec(), REDIS_TIMEOUT_MS);
      } catch (err) {
        logError('Redis admin update failed', err);
        throw new Error('Unable to update the shared state');
      }
    }
    await mutateFile(data => ({
      ...data,
      eventText: textChanged ? eventText : data.eventText,
      ...(countChanged ? { count: requestedCount, ips: [], eventId: Date.now().toString() } : {})
    }));
    const state = await getState('');
    return { count: state.count, eventText: state.eventText };
  }

  const server = http.createServer(async (req, res) => {
    setSecurityHeaders(res);
    const requestUrl = safeUrl(req.url);
    if (!requestUrl) return sendText(res, 400, 'Bad Request');

    try {
      if (req.method === 'GET' && requestUrl.pathname === '/api/state') {
        return sendJson(res, 200, await getState(getClientIp(req, trustProxy)));
      }
      if (req.method === 'GET' && requestUrl.pathname === '/api/count') {
        const { count } = await getState('');
        return sendJson(res, 200, { count });
      }
      if (req.method === 'POST' && requestUrl.pathname === '/api/increment') {
        await readBody(req);
        const count = await addIp(getClientIp(req, trustProxy));
        return sendJson(res, 200, { count, clicked: true });
      }
      if (req.method === 'POST' && requestUrl.pathname === '/api/admin') {
        const ip = getClientIp(req, trustProxy);
        if (isRateLimited(loginFailures, ip)) return sendText(res, 429, 'Too Many Attempts');
        const data = JSON.parse((await readBody(req)) || '{}');
        if (!safeSecretEqual(data.password, adminPassword)) {
          recordLoginFailure(loginFailures, ip);
          return sendText(res, 401, 'Unauthorized');
        }
        loginFailures.delete(ip);
        if (data.eventText !== undefined && (typeof data.eventText !== 'string' || data.eventText.length > MAX_EVENT_TEXT)) {
          return sendText(res, 400, 'Event text must be 500 characters or fewer');
        }
        const requestedCount = data.resetCount === true ? 0 : data.count;
        if (requestedCount !== undefined && (!Number.isSafeInteger(requestedCount) || requestedCount < 0)) {
          return sendText(res, 400, 'Count must be a non-negative whole number');
        }
        return sendJson(res, 200, await updateAdminState(data.eventText, requestedCount));
      }
      if (req.method === 'GET') return serveStatic(requestUrl.pathname, res);
      return sendText(res, 405, 'Method Not Allowed');
    } catch (err) {
      if (err.code === 'BODY_TOO_LARGE') return sendText(res, 413, 'Payload Too Large');
      if (err instanceof SyntaxError) return sendText(res, 400, 'Bad Request');
      logError('Request failed', err);
      return sendJson(res, 500, { error: 'Request failed' });
    }
  });

  server.requestTimeout = 10_000;
  server.headersTimeout = 12_000;
  server.keepAliveTimeout = 5_000;
  return { server, adminPassword, redis };
}

function createRedisClient() {
  if (!process.env.REDIS_URL || !RedisLib) return null;
  const client = new RedisLib(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: times => Math.min(times * 500, 5000) });
  client.on('error', err => logError('Redis connection error', err));
  return client;
}

function defaultData() { return { count: 0, eventText: 'Event Text', eventId: Date.now().toString(), ips: [] }; }

function readDataFile(dataFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return {
      count: Number.isSafeInteger(parsed.count) && parsed.count >= 0 ? parsed.count : 0,
      eventText: typeof parsed.eventText === 'string' ? parsed.eventText.slice(0, MAX_EVENT_TEXT) : 'Event Text',
      eventId: typeof parsed.eventId === 'string' ? parsed.eventId : Date.now().toString(),
      ips: Array.isArray(parsed.ips) ? [...new Set(parsed.ips.filter(ip => typeof ip === 'string' && ip.length <= 64))] : []
    };
  } catch (err) {
    logError('Data file could not be read', err);
    return defaultData();
  }
}

function writeDataFile(dataFile, data) {
  const tempFile = `${dataFile}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempFile, dataFile);
}

function ensureDataFile(dataFile) { if (!fs.existsSync(dataFile)) writeDataFile(dataFile, defaultData()); }

function safeUrl(value) { try { return new URL(value, 'http://localhost'); } catch (_) { return null; } }

function serveStatic(pathname, res) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch (_) { return sendText(res, 400, 'Bad Request'); }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relative);
  const withinPublic = path.relative(PUBLIC_DIR, filePath);
  if (withinPublic.startsWith('..') || path.isAbsolute(withinPublic)) return sendText(res, 403, 'Forbidden');
  fs.readFile(filePath, (err, data) => {
    if (err) return sendText(res, 404, 'Not Found');
    const types = {
      '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
    };
    res.writeHead(200, { 'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': path.extname(filePath) === '.html' ? 'no-store' : 'public, max-age=3600' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let tooLarge = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { tooLarge = true; body = ''; return; }
      if (!tooLarge) body += chunk;
    });
    req.on('end', () => {
      if (tooLarge) { const err = new Error('Body too large'); err.code = 'BODY_TOO_LARGE'; reject(err); return; }
      resolve(body);
    });
    req.on('error', reject);
  });
}

function getClientIp(req, trustProxy) {
  let value = req.socket.remoteAddress || '';
  if (trustProxy && typeof req.headers['x-forwarded-for'] === 'string') value = req.headers['x-forwarded-for'].split(',')[0].trim();
  const normalized = value.startsWith('::ffff:') ? value.slice(7) : value;
  return net.isIP(normalized) ? normalized : 'unknown';
}

function safeSecretEqual(candidate, expected) {
  if (typeof candidate !== 'string') return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function recordLoginFailure(store, ip) {
  const now = Date.now();
  const current = store.get(ip);
  store.set(ip, !current || now - current.startedAt > LOGIN_WINDOW_MS ? { count: 1, startedAt: now } : { ...current, count: current.count + 1 });
}

function isRateLimited(store, ip) {
  const current = store.get(ip);
  if (!current) return false;
  if (Date.now() - current.startedAt > LOGIN_WINDOW_MS) { store.delete(ip); return false; }
  return current.count >= MAX_LOGIN_FAILURES;
}

function setSecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
}

function sendJson(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
function sendText(res, status, value) { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(value); }
function withTimeout(promise, ms) { return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]); }
function logError(message, err) { if (process.env.NODE_ENV !== 'test') console.error(`[server] ${message}:`, err && err.message ? err.message : err); }

if (require.main === module) {
  const { server, adminPassword, redis } = createApp();
  const port = Number(process.env.PORT) || 3000;
  const trustProxy = process.env.TRUST_PROXY === 'true';
  if (!process.env.ADMIN_PASSWORD) console.log(`Generated admin password for this run: ${adminPassword}`);
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log(`Redis: ${redis ? 'enabled' : 'disabled (file storage only)'}; trust proxy: ${trustProxy}`);
    if (redis && !trustProxy) {
      console.warn('[server] TRUST_PROXY is not "true". Behind a hosting proxy every visitor shares one IP, so only the first click will ever count.');
    }
  });
  const shutdown = () => server.close(async () => { if (redis) await redis.quit().catch(() => redis.disconnect()); process.exit(0); });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createApp, getClientIp, safeSecretEqual };
