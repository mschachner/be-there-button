# Official Math Department Be There Button

A single page with a very large red button. Clicking it once increments a shared count; clicking it again is strictly prohibited.

## Layout

```
server.js            HTTP server, JSON API, static files (no framework)
public/index.html    the page
public/styles.css    the page's styling
public/js/main.js    entry point: button, tally, status line
public/js/api.js     fetch wrappers for /api/*
public/js/odometer.js  the rolling digit counter
public/js/confetti.js  confetti burst
public/js/admin.js   password-protected admin dialog
test/                node:test suite
```

## Running locally

```sh
npm install
npm run dev          # ADMIN_PASSWORD=dev, http://localhost:3000
npm test
```

## Configuration

| Variable         | Purpose                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `PORT`           | Port to listen on (default 3000).                                       |
| `ADMIN_PASSWORD` | Password for the admin dialog. A random one is printed if unset.        |
| `REDIS_URL`      | Optional. Shared storage for the count, the clicked IPs and the event text. Without it, everything lives in `data.json` next to the server. |
| `REDIS_KEY`      | Optional key prefix (default `be-there:count`).                          |
| `TRUST_PROXY`    | Set to `true` when running behind a hosting proxy (Railway, Render, Fly). Otherwise every visitor looks like the same IP and only the first click counts. |

## API

- `GET  /api/state` → `{ count, eventText, clicked }` (`clicked` is per requesting IP)
- `GET  /api/count` → `{ count }`
- `POST /api/increment` → `{ count, clicked: true }` (idempotent per IP)
- `POST /api/admin` with `{ password, eventText?, count?, resetCount? }` → `{ count, eventText }`

## Deploying

The server is stateless apart from Redis, so any Node host works. Set `REDIS_URL`, `ADMIN_PASSWORD` and `TRUST_PROXY=true`; the start command is `npm start`.
