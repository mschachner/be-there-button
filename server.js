const http = require('http');
const fs = require('fs');
const path = require('path');
const RedisLib = (() => { try { return require('ioredis'); } catch (_) { return null; } })();

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const REDIS_URL = process.env.REDIS_URL;
const REDIS_KEY = process.env.REDIS_KEY || 'be-there:count';

const redis = (REDIS_URL && RedisLib) ? new RedisLib(REDIS_URL, { lazyConnect: false }) : null;

function readCountFile() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.count === 'number' && parsed.count >= 0) return parsed.count;
  } catch (_err) {}
  return 0;
}

function writeCountFile(count) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ count }), 'utf8');
}

async function readCount() {
  if (redis) {
    try {
      const value = await redis.get(REDIS_KEY);
      const asNumber = Number.parseInt(value ?? '0', 10);
      return Number.isFinite(asNumber) ? asNumber : 0;
    } catch (_err) {
      return readCountFile();
    }
  }
  return readCountFile();
}

async function incrementCount() {
  if (redis) {
    try {
      const newValue = await redis.incr(REDIS_KEY);
      return newValue;
    } catch (_err) {
      const c = readCountFile() + 1;
      writeCountFile(c);
      return c;
    }
  }
  const c = readCountFile() + 1;
  writeCountFile(c);
  return c;
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
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      incrementCount().then(count => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ count }));
      }).catch(() => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to increment' }));
      });
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
  writeCountFile(0);
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


