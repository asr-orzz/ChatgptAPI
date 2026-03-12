const fs = require("fs");
const path = require("path");
const { selectors, isAnyVisible } = require("./selectors");

const sessionFile = path.resolve(
  process.cwd(),
  process.env.CHATGPT_SESSION_FILE || "sessions/auth.json"
);
const debugDir = path.resolve(process.cwd(), process.env.CHATGPT_DEBUG_DIR || "debug");
const sessionHosts = ["chatgpt.com", "chat.openai.com", "openai.com"];

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

function isStorageStateLike(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray(value.cookies) &&
    Array.isArray(value.origins)
  );
}

function normalizeStorageState(rawValue) {
  let storageState = rawValue;

  if (typeof storageState === "string") {
    storageState = JSON.parse(storageState);
  }

  if (!isStorageStateLike(storageState)) {
    throw new Error(
      "Expected a Playwright storage state JSON object with \"cookies\" and \"origins\" arrays."
    );
  }

  return {
    cookies: storageState.cookies,
    origins: storageState.origins
  };
}

async function writeStorageState(storageState) {
  await ensureRuntimeDirectories();
  const normalized = normalizeStorageState(storageState);
  const tempPath = `${sessionFile}.${process.pid}.${Date.now()}.tmp`;

  await fs.promises.writeFile(tempPath, JSON.stringify(normalized, null, 2), "utf8");

  try {
    await fs.promises.rename(tempPath, sessionFile);
  } catch (error) {
    if (error.code !== "EEXIST" && error.code !== "EPERM") {
      throw error;
    }

    await fs.promises.rm(sessionFile, { force: true });
    await fs.promises.rename(tempPath, sessionFile);
  }

  return sessionFile;
}

async function readStorageState() {
  if (!(await sessionFileExists())) {
    return null;
  }

  const body = await fs.promises.readFile(sessionFile, "utf8");
  return normalizeStorageState(body);
}

async function clearStorageState() {
  await fs.promises.rm(sessionFile, { force: true });
}

async function getSessionFileMetadata() {
  try {
    const stats = await fs.promises.stat(sessionFile);
    return {
      exists: true,
      size_bytes: stats.size,
      updated_at: stats.mtime.toISOString()
    };
  } catch (_error) {
    return {
      exists: false,
      size_bytes: 0,
      updated_at: null
    };
  }
}

function summarizeStorageState(storageState) {
  const normalized = normalizeStorageState(storageState);
  const chatgptCookies = normalized.cookies.filter((cookie) =>
    sessionHosts.some((host) => String(cookie.domain || "").includes(host))
  );
  const chatgptOrigins = normalized.origins.filter((origin) =>
    sessionHosts.some((host) => String(origin.origin || "").includes(host))
  );

  return {
    cookie_count: normalized.cookies.length,
    origin_count: normalized.origins.length,
    chatgpt_cookie_count: chatgptCookies.length,
    chatgpt_origin_count: chatgptOrigins.length
  };
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
  clearStorageState,
  ensureRuntimeDirectories,
  getDebugDirectory,
  getSessionFilePath,
  getSessionFileMetadata,
  isLoggedOut,
  normalizeStorageState,
  readStorageState,
  saveStorageState,
  summarizeStorageState,
  sessionFileExists,
  verifySession,
  writeStorageState
};
