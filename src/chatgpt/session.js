const fs = require("fs");
const path = require("path");
const { selectors, isAnyVisible } = require("./selectors");

const sessionFile = path.resolve(
  process.cwd(),
  process.env.CHATGPT_SESSION_FILE || "sessions/auth.json"
);
const debugDir = path.resolve(process.cwd(), process.env.CHATGPT_DEBUG_DIR || "debug");

async function ensureRuntimeDirectories() {
  await fs.promises.mkdir(path.dirname(sessionFile), { recursive: true });
  await fs.promises.mkdir(debugDir, { recursive: true });
}

function getSessionFilePath() {
  return sessionFile;
}

function getDebugDirectory() {
  return debugDir;
}

async function sessionFileExists() {
  try {
    await fs.promises.access(sessionFile, fs.constants.F_OK);
    return true;
  } catch (_error) {
    return false;
  }
}

async function saveStorageState(context) {
  await ensureRuntimeDirectories();
  await context.storageState({ path: sessionFile });
  return sessionFile;
}

async function isLoggedOut(page) {
  const url = page.url();

  if (/\/auth\/login/i.test(url) || /auth0|login|signup/i.test(url)) {
    return true;
  }

  const hasLoggedInUI = await isAnyVisible(page, selectors.loginSuccessIndicators, {
    timeout: 1000
  });

  if (hasLoggedInUI) {
    return false;
  }

  return isAnyVisible(page, selectors.loggedOutIndicators, { timeout: 1000 });
}

async function verifySession(page, logger) {
  logger?.info("Verifying saved session");
  const settleTimeout = Math.min(
    Number(process.env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS || 45000),
    15000
  );

  const hasLoggedInUI = await isAnyVisible(page, selectors.loginSuccessIndicators, {
    timeout: settleTimeout
  });

  if (hasLoggedInUI) {
    return { valid: true };
  }

  if (await isLoggedOut(page)) {
    return { valid: false, reason: "Session appears logged out or expired." };
  }

  const hasNewChat = await isAnyVisible(page, selectors.newChatButtons, {
    timeout: Math.min(settleTimeout, 5000)
  });

  if (hasNewChat) {
    return { valid: true };
  }

  return { valid: false, reason: "Unable to confirm an authenticated ChatGPT session." };
}

module.exports = {
  ensureRuntimeDirectories,
  getDebugDirectory,
  getSessionFilePath,
  isLoggedOut,
  saveStorageState,
  sessionFileExists,
  verifySession
};
