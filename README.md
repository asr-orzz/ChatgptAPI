# ChatGPT Web UI API

Self-hosted single-tenant project that lets one owner deploy their own instance, log into ChatGPT manually in a browser running on the server, and then call a private `/ask` API.

## What this is

- One deployed instance per owner
- Manual ChatGPT login only
- Saved session per deployment
- HTTP API for `/ask`
- Small admin page at `/`
- Docker/noVNC support for remote manual login

## What this is not

- Not a multi-tenant SaaS
- Not guaranteed stable against future ChatGPT UI changes
- Not a pure headless browser system

## Project structure

```text
package.json
server.js
Dockerfile
docker-compose.yml
docker/start.sh
public/index.html
src/chatgpt/browser.js
src/chatgpt/login.js
src/chatgpt/loginSession.js
src/chatgpt/ask.js
src/chatgpt/selectors.js
src/chatgpt/session.js
src/utils/auth.js
src/utils/logger.js
src/utils/queue.js
src/utils/wait.js
.env.example
README.md
```

## Main usage modes

### Local development

Run locally and log in with a visible browser:

```bash
npm install
npm run login
npm run start
```

### Self-hosted deployment

1. Deploy with Docker
2. Open the admin page at `http://your-host:3000/`
3. Start a login session
4. Open the noVNC link
5. Log into ChatGPT manually in the remote browser
6. Wait for the session to become `ready`
7. Use `/ask`

## Endpoints

### `GET /health`

Basic health and queue status.

### `GET /login/status`

Reports whether a login session is idle/running/ready/error and returns the noVNC URL.

### `POST /login/start`

Starts a remote manual-login session in a non-headless browser on the server.

### `POST /login/cancel`

Cancels the current remote login session.

### `POST /ask`

Request:

```json
{
  "prompt": "Explain recursion simply"
}
```

Success:

```json
{
  "ok": true,
  "answer": "Recursion is ...",
  "timing_ms": {
    "startup": 0,
    "navigation": 0,
    "submission": 0,
    "wait_for_response": 0,
    "scrape": 0,
    "total": 0
  }
}
```

Failure:

```json
{
  "ok": false,
  "error": "clear error message"
}
```

## API auth

If you set `API_BEARER_TOKEN`, send it as:

```bash
curl -X POST http://localhost:3000/ask \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Explain recursion simply"}'
```

If `API_BEARER_TOKEN` is blank, the service is open. Do not expose it publicly that way.

## Example `.env`

```dotenv
PORT=3000
LOG_LEVEL=info
API_BEARER_TOKEN=change-this-before-exposing-the-service
PUBLIC_BASE_URL=http://localhost:3000
CHATGPT_BASE_URL=https://chatgpt.com
CHATGPT_LOGIN_URL=https://chatgpt.com/auth/login
PLAYWRIGHT_HEADLESS=false
PLAYWRIGHT_LOGIN_HEADLESS=false
PLAYWRIGHT_START_MINIMIZED=true
PLAYWRIGHT_SLOW_MO=0
PLAYWRIGHT_BROWSER_CHANNEL=
PLAYWRIGHT_NAVIGATION_TIMEOUT_MS=45000
CHATGPT_RESPONSE_TIMEOUT_MS=180000
CHATGPT_CHALLENGE_TIMEOUT_MS=15000
CHATGPT_STABILITY_POLL_INTERVAL_MS=1000
CHATGPT_STABILITY_POLLS=3
CHATGPT_QUEUE_CONCURRENCY=1
CHATGPT_SESSION_FILE=sessions/auth.json
CHATGPT_DEBUG_DIR=debug
LOGIN_SESSION_TIMEOUT_MS=900000
ENABLE_XVFB=true
ENABLE_VNC=true
DISPLAY=:99
XVFB_WHD=1440x1024x24
VNC_PORT=5900
NOVNC_PORT=6080
NOVNC_PUBLIC_PORT=6080
VNC_PASSWORD=
```

## Docker deployment

### 1. Build and run

```bash
docker compose up --build
```

### 2. Open the admin page

```text
http://localhost:3000/
```

### 3. Start remote login

- Enter your bearer token in the page if configured
- Click `Start Login Session`
- Open the noVNC URL shown on the page
- Log into ChatGPT manually
- Wait for status `ready`

### 4. Call the API

```bash
curl -X POST http://localhost:3000/ask \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Explain recursion simply"}'
```

## Why Docker/noVNC exists

For remote deployment, there is no normal desktop window to click through. This project uses:

- `Xvfb` for a virtual display
- a headed browser for better reliability than headless mode
- `x11vnc` and `noVNC` so you can log into ChatGPT manually from your own browser

That gives you a browser running on the server without needing a physical monitor.

## Files persisted on disk

- Session state: `sessions/auth.json`
- Failure screenshots: `debug/*.png`
- Failure HTML dumps: `debug/*.html`

Mount `sessions/` and `debug/` as volumes in Docker.

## Operational notes

- Default queue concurrency is `1`
- One saved session per deployed instance
- This project is meant for one owner per deployment
- Remote login uses a separate temporary browser session that auto-saves the auth state when login succeeds

## Troubleshooting

### Session missing or expired

- Start a new login session from `/` or `POST /login/start`
- Open the noVNC link
- Log into ChatGPT manually again

### Login session never becomes ready

- Check the noVNC URL is reachable
- Complete any Cloudflare or verification screen manually
- Increase `LOGIN_SESSION_TIMEOUT_MS` if needed

### `/ask` fails after login

- Inspect the newest files in `debug/`
- Check for UI changes or challenge pages
- Update selectors in `src/chatgpt/selectors.js`

### I do not want visible browser windows during normal requests

- Keep `PLAYWRIGHT_HEADLESS=false`
- Use Docker with `Xvfb`
- The browser will run off-screen on the server display

### Security checklist

- Set `API_BEARER_TOKEN`
- Set `VNC_PASSWORD` if you expose noVNC/VNC outside a trusted network
- Restrict ports `3000`, `5900`, and `6080`
- Put the service behind your own reverse proxy if exposing it publicly
