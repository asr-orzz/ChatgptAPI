# ChatGPT Web UI API

Single-user Express API that reuses a saved ChatGPT browser session. The UI is centered on one flow: upload cookies or a Playwright session JSON, save it on the server, then call `/ask`.

## Main flow

1. Export ChatGPT cookies, or generate `sessions/auth.json` locally with `npm run login`.
2. Open the app at `/`.
3. Upload or paste the JSON.
4. Click `Import And Save Session`.
5. Wait until the saved session status is `ready`.
6. Use `/ask`.

No bearer token is required. noVNC and remote-browser login are not part of the app anymore.

## Endpoints

### `GET /health`

Returns queue status and current saved-session metadata.

### `GET /session/status`

Returns whether the saved session is `empty`, `invalid`, or `ready`.

### `POST /session/import`

Imports and verifies one of these:

- Raw cookie JSON array
- JSON object with `cookies`
- Full Playwright storage-state JSON

Example:

```bash
curl -X POST http://localhost:3000/session/import \
  -H "Content-Type: application/json" \
  --data-binary @cookies.json
```

### `GET /session/export`

Returns the currently saved Playwright storage-state JSON.

### `DELETE /session`

Deletes the saved session file.

### `POST /ask`

Request:

```json
{
  "prompt": "Explain recursion simply"
}
```

## Local use

```bash
npm install
npm run login
npm run start
```

`npm run login` opens a normal browser, waits for you to log into ChatGPT, and saves `sessions/auth.json`. You can use that file directly in the UI.

## Docker

```bash
docker compose up --build
```

Open:

```text
http://localhost:3000/
```

Only port `3000` is exposed now.

## Example `.env`

```dotenv
PORT=3000
LOG_LEVEL=info
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
ENABLE_XVFB=true
DISPLAY=:99
XVFB_WHD=1440x1024x24
```

## Files on disk

- Session file: `sessions/auth.json`
- Debug screenshots: `debug/*.png`
- Debug HTML: `debug/*.html`

## Troubleshooting

### Import fails

- Make sure the JSON is valid.
- If you upload cookies, each cookie needs `name`, `value`, and either `domain` or `url`.
- If verification fails, the cookies/session are expired or incomplete.

### `/ask` fails after import

- The imported session may be logged out or expired.
- Inspect the newest files in `debug/`.
- Generate a fresh `sessions/auth.json` with `npm run login` and import it again.

## Security

The saved session file is effectively your ChatGPT login state. Protect access to this service and to `sessions/auth.json`.
