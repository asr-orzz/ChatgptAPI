# ChatGPT Web UI API

Self-hosted single-tenant project that reuses a saved ChatGPT browser session and exposes a private `/ask` API.

## What changed

The preferred login flow no longer depends on noVNC.

Primary path:

1. Run the repo locally on your own machine.
2. Execute `npm run login` and finish ChatGPT login in a normal browser.
3. Take the generated `sessions/auth.json` file.
4. Upload or paste that Playwright storage state into the deployed service.
5. Use `/ask`.

The old remote login endpoints still exist, but the dashboard now treats session import as the main path.

## What this is

- One deployed instance per owner
- Manual ChatGPT login only
- One saved browser session per deployment
- HTTP API for `/ask`
- Admin page at `/`
- Optional legacy Docker/noVNC support if you still want remote server-side login

## Main usage modes

### Local development

```bash
npm install
npm run login
npm run start
```

### Self-hosted deployment without noVNC

1. Deploy the service
2. Open `/`
3. Paste `API_BEARER_TOKEN` if configured
4. Upload or paste a Playwright storage state JSON
5. Wait for import verification to succeed
6. Use `/ask`

## Endpoints

### `GET /health`

Basic health, queue status, and optional legacy remote-browser diagnostics.

### `GET /login/status`

Returns current remote-login status plus saved session metadata such as file path, file size, and cookie/origin summary.

### `POST /session/import`

Imports and verifies a Playwright storage state before saving it as the server session.

Accepted body:

- Raw Playwright storage state JSON
- JSON object with `cookies` and `origins` arrays

Example:

```bash
curl -X POST http://localhost:3000/session/import \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @sessions/auth.json
```

### `GET /session/export`

Returns the currently saved storage state JSON.

### `DELETE /session`

Deletes the saved storage state file.

### `POST /login/start`

Starts the older remote manual-login session in a non-headless browser on the server.

### `POST /login/cancel`

Cancels the older remote login session.

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

## API auth

If you set `API_BEARER_TOKEN`, send it as:

```bash
curl -X POST http://localhost:3000/ask \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Explain recursion simply"}'
```

If `API_BEARER_TOKEN` is blank, the service is open.

## Example `.env`

```dotenv
PORT=3000
LOG_LEVEL=info
API_BEARER_TOKEN=change-this-before-exposing-the-service
PUBLIC_BASE_URL=
CHATGPT_BASE_URL=https://chatgpt.com
CHATGPT_LOGIN_URL=https://chatgpt.com/auth/login
PLAYWRIGHT_HEADLESS=false
PLAYWRIGHT_LOGIN_HEADLESS=false
PLAYWRIGHT_START_MINIMIZED=true
PLAYWRIGHT_DISABLE_SANDBOX=true
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
NOVNC_SAME_ORIGIN=true
NOVNC_STATIC_DIR=/usr/share/novnc
VNC_PASSWORD=
```

If you do not intend to use the legacy remote login path, the important setting is still `CHATGPT_SESSION_FILE`; that is where imported sessions are stored.

## Session import workflow

### Option 1: Generate the session with this repo locally

```bash
npm install
npm run login
```

That writes the Playwright storage state to `sessions/auth.json`. Upload that file through `/` or `POST /session/import`.

### Option 2: Import through the admin page

1. Open `/`
2. Save the bearer token if required
3. Load a JSON file or paste the storage state text
4. Click `Import And Verify Session`
5. Wait for the success notice

### Option 3: Import through the API

```bash
curl -X POST http://localhost:3000/session/import \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @sessions/auth.json
```

## Files persisted on disk

- Session state: `sessions/auth.json`
- Failure screenshots: `debug/*.png`
- Failure HTML dumps: `debug/*.html`

Mount `sessions/` and `debug/` as volumes in Docker.

## Legacy remote-login notes

Docker/noVNC support is still present for environments where you explicitly want a server-side headed browser and remote desktop. It is now optional rather than the main operational path.

If you still use it:

- `POST /login/start` starts the remote browser
- `/login/status` returns the noVNC URL
- `POST /login/cancel` stops that session

## Troubleshooting

### Session import fails

- Confirm the JSON is a real Playwright storage state with `cookies` and `origins`
- Generate a fresh file with `npm run login`
- Make sure the imported file was captured after ChatGPT login completed
- If verification hits Cloudflare, retry with a fresher session file

### `/ask` fails after a successful import

- Inspect the newest files in `debug/`
- Check whether the ChatGPT session expired
- Regenerate and re-import the session file
- Update selectors in `src/chatgpt/selectors.js` if the ChatGPT UI changed

### I still want remote login

- Keep the current Docker setup
- Use `POST /login/start`
- Open the noVNC URL from `/login/status`
- Complete login manually in the remote browser

## Security checklist

- Set `API_BEARER_TOKEN`
- Treat `sessions/auth.json` and `/session/export` as sensitive credentials
- Restrict access to the admin page and API
- Set `VNC_PASSWORD` if you still expose noVNC/VNC
