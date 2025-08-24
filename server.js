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
      eventText: typeof parsed.eventText === 'string' ? parsed.eventText : 'Event Text',
      eventId: typeof parsed.eventId === 'string' ? parsed.eventId : Date.now().toString(),
      ips: Array.isArray(parsed.ips) ? parsed.ips.filter(ip => typeof ip === 'string') : []
    };
  } catch (_err) {
    const id = Date.now().toString();
    return { count: 0, eventText: 'Event Text', eventId: id, ips: [] };
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

async function resetCount() {
  if (redis) {
    try {
      await redis.set(REDIS_KEY, '0');
    } catch (_err) {}
  }
  const data = readDataFile();
  const updated = { ...data, count: 0, ips: [], eventId: Date.now().toString() };
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

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

function hasIp(ip) {
  return readDataFile().ips.includes(ip);
}

async function addIp(ip) {
  const data = readDataFile();
  if (data.ips.includes(ip)) {
    return data.count;
  }
  let count = data.count + 1;
  if (redis) {
    try {
      count = await redis.incr(REDIS_KEY);
    } catch (_err) {}
  }
  const updated = { ...data, count, ips: [...data.ips, ip] };
  writeDataFile(updated);
  return count;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c] || c));
}

function serveStatic(req, res) {
  let filePath = req.url === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, req.url);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (filePath === path.join(PUBLIC_DIR, 'index.html')) {
    fs.readFile(filePath, 'utf8', (err, html) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const data = readDataFile();
      const ip = getClientIp(req);
      const clicked = data.ips.includes(ip);
      const statusText = clicked
        ? 'You have clicked the Be There Button. Please do not click the button again...'
        : 'You have not clicked the Be There Button.';
      const stateScript = `<script>window.__INITIAL_STATE__=${JSON.stringify({ count: data.count, eventText: data.eventText, clicked })};</script>`;
      const rendered = html
        .replace('Event Text', escapeHtml(data.eventText))
        .replace('0 people will be there.', `${data.count} ${data.count === 1 ? 'person' : 'people'} will be there.`)
        .replace('You have not clicked the Be There Button.', statusText)
        .replace('<script src="/script.js"></script>', `${stateScript}<script src="/script.js"></script>`);
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end(rendered);
    });
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
    const ip = getClientIp(req);
    const clicked = hasIp(ip);
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
    const ip = getClientIp(req);
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      const finish = (count) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ count, clicked: true }));
      };

      const handleError = () => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to increment' }));
      };

      addIp(ip).then((count) => finish(count)).catch(handleError);
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
  writeDataFile({ count: 0, eventText: 'Event Text', eventId: Date.now().toString(), ips: [] });
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


