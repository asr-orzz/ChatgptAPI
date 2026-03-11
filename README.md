# ChatGPT Playwright API

This project exposes a local Express API that drives the ChatGPT web UI with Playwright. Authentication is manual only: the code never asks for, stores, or submits your email, password, or 2FA code.

## What it does

- `npm run login` opens a visible browser window on the ChatGPT login page.
- You complete login manually in the browser.
- The script detects a successful login and saves Playwright storage state to `sessions/auth.json`.
- `POST /ask` reuses that saved session, opens ChatGPT, starts a fresh chat, submits the prompt, waits for streaming to finish, scrapes the latest assistant reply, and returns plain text JSON.
- If the session is missing or expired, the API returns a friendly error telling you to run `npm run login` again.

## Project structure

```text
package.json
server.js
src/chatgpt/browser.js
src/chatgpt/login.js
src/chatgpt/ask.js
src/chatgpt/selectors.js
src/chatgpt/session.js
src/utils/logger.js
src/utils/wait.js
src/utils/queue.js
.env.example
README.md
```

## Installation

1. Install Node.js 18+.
2. Copy `.env.example` to `.env` and adjust values if needed.
3. Install dependencies:

```bash
npm install
```

4. Install the Playwright browser if your environment does not already have it:

```bash
npx playwright install chromium
```

## Environment variables

```dotenv
PORT=3000
LOG_LEVEL=info
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
```

Notes:

- `PLAYWRIGHT_LOGIN_HEADLESS` defaults to `false` so login happens in a visible browser.
- `PLAYWRIGHT_HEADLESS` controls the browser used for normal API requests.
- `PLAYWRIGHT_HEADLESS=false` is the safer default because ChatGPT frequently challenges headless browsers with Cloudflare.
- `PLAYWRIGHT_START_MINIMIZED=true` starts the non-headless browser minimized so normal API calls stay mostly in the background.
- `CHATGPT_QUEUE_CONCURRENCY=1` prevents concurrent requests from fighting over the same UI session.
- `PLAYWRIGHT_BROWSER_CHANNEL=chrome` can be useful if you want Playwright to drive your installed Chrome instead of bundled Chromium.

## Manual login flow

Run:

```bash
npm run login
```

Behavior:

- Opens the ChatGPT login page in a visible browser.
- Waits for you to finish login manually.
- Detects authenticated UI markers.
- Saves Playwright storage state to `sessions/auth.json`.
- Closes the browser afterward.

The login script never reads or logs raw credentials.

## Start the API server

Development:

```bash
npm run dev
```

Production-style:

```bash
npm run start
```

## API

### `GET /health`

Returns a simple status payload including queue state.

### `POST /ask`

Request body:

```json
{
  "prompt": "your prompt here"
}
```

Success response:

```json
{
  "ok": true,
  "answer": "scraped response text",
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

Failure response:

```json
{
  "ok": false,
  "error": "clear error message"
}
```

## Example curl

```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Explain recursion simply"}'
```

PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/ask `
  -ContentType "application/json" `
  -Body '{"prompt":"Explain recursion simply"}'
```

## Session and debug artifacts

- Saved session file: `sessions/auth.json`
- Failure screenshots: `debug/<timestamp>-ask-attempt-*.png`
- Failure HTML dumps: `debug/<timestamp>-ask-attempt-*.html`

The code logs the saved artifact paths on failures so you can inspect the exact page state that caused the problem.

## Selector maintenance

If the ChatGPT UI changes, update selector fallbacks in `src/chatgpt/selectors.js`.

Key selector groups:

- `loginSuccessIndicators`
- `loggedOutIndicators`
- `newChatButtons`
- `composerInputs`
- `sendButtons`
- `assistantMessages`
- `stopGeneratingButtons`
- `modalCloseButtons`

## Reliability notes

- Every major step uses explicit timeouts.
- `/ask` retries once on transient UI failures.
- If Cloudflare blocks the headless browser, the code retries once in a visible browser window.
- Each request uses a fresh browser context with the saved storage state.
- Contexts and pages are always closed after each request.
- The latest assistant response is considered complete only after the text stays stable across multiple polls and any stop-generating control is gone.

## Limitations

- ChatGPT’s web UI changes over time. Selectors and flow assumptions may need updates.
- Browser automation against consumer web apps can break due to experiments, captchas, modal changes, or anti-automation checks.
- Headless mode is less reliable because Cloudflare may challenge or block it before the chat UI loads.
- Because login is manual only, renewing an expired session still requires running `npm run login`.
