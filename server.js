const http = require('http');
const fs = require('fs');
const path = require('path');
const RedisLib = (() => { try { return require('ioredis'); } catch (_) { return null; } })();

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const REDIS_URL = process.env.REDIS_URL;
const REDIS_KEY = process.env.REDIS_KEY || 'be-there:count';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const CLICK_COOKIE = 'be-there-clicked';

const redis = (REDIS_URL && RedisLib)
  ? new RedisLib(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    })
  : null;

if (redis) {
  redis.on('error', (err) => {
    const message = (err && err.message) ? err.message : String(err);
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[redis] error:', message);
    }
  });
}

function readDataFile() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      count: typeof parsed.count === 'number' && parsed.count >= 0 ? parsed.count : 0,
      eventText: typeof parsed.eventText === 'string' ? parsed.eventText : 'Event Text'
    };
  } catch (_err) {
    return { count: 0, eventText: 'Event Text' };
  }
}

function writeDataFile(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf8');
}

async function readCount() {
  if (redis) {
    try {
      const value = await redis.get(REDIS_KEY);
      const asNumber = Number.parseInt(value ?? '0', 10);
      return Number.isFinite(asNumber) ? asNumber : 0;
    } catch (_err) {
      return readDataFile().count;
    }
  }
  return readDataFile().count;
}

async function incrementCount() {
  if (redis) {
    try {
      const newValue = await redis.incr(REDIS_KEY);
      return newValue;
    } catch (_err) {
      const data = readDataFile();
      const c = data.count + 1;
      writeDataFile({ ...data, count: c });
      return c;
    }
  }
  const data = readDataFile();
  const c = data.count + 1;
  writeDataFile({ ...data, count: c });
  return c;
}

async function resetCount() {
  if (redis) {
    try {
      await redis.set(REDIS_KEY, '0');
    } catch (_err) {}
  }
  const data = readDataFile();
  const updated = { ...data, count: 0 };
  writeDataFile(updated);
  return 0;
}

function getEventText() {
  return readDataFile().eventText;
}

function setEventText(text) {
  const data = readDataFile();
  const updated = { ...data, eventText: text };
  writeDataFile(updated);
  return text;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, pair) => {
    const [k, v] = pair.trim().split('=');
    if (k) acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {});
}

function serveStatic(req, res) {
  let filePath = req.url === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, req.url);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/state') {
    const cookies = parseCookies(req);
    const clicked = cookies[CLICK_COOKIE] === 'true';
    readCount()
      .then((count) => {
        const eventText = getEventText();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ count, eventText, clicked }));
      })
      .catch(() => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to read state' }));
      });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/count') {
    readCount().then(count => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ count }));
    }).catch(() => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read count' }));
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/increment') {
    const cookies = parseCookies(req);
    const alreadyClicked = cookies[CLICK_COOKIE] === 'true';
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      const finish = (count, setCookie) => {
        const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
        if (setCookie) {
          headers['Set-Cookie'] = `${CLICK_COOKIE}=true; Path=/; Max-Age=31536000`;
        }
        res.writeHead(200, headers);
        res.end(JSON.stringify({ count, clicked: true }));
      };

      const handleError = () => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to increment' }));
      };

      if (alreadyClicked) {
        readCount().then((count) => finish(count, false)).catch(handleError);
      } else {
        incrementCount().then((count) => finish(count, true)).catch(handleError);
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/admin') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        if (data.password !== ADMIN_PASSWORD) {
          res.writeHead(401);
          res.end('Unauthorized');
          return;
        }

        if (typeof data.eventText === 'string') {
          setEventText(data.eventText);
        }
        let count = await readCount();
        if (data.resetCount) {
          count = await resetCount();
        }
        const eventText = getEventText();

        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ count, eventText }));
      } catch (_err) {
        res.writeHead(400);
        res.end('Bad Request');
      }
    });
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end('Method Not Allowed');
});

// Ensure data file exists for fallback
if (!fs.existsSync(DATA_FILE)) {
  writeDataFile({ count: 0, eventText: 'Event Text' });
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


