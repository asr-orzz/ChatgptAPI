const { launchBrowser } = require("./browser");
const { selectors, isAnyVisible } = require("./selectors");
const {
  ensureRuntimeDirectories,
  getSessionFilePath,
  isLoggedOut,
  saveStorageState,
  sessionFileExists
} = require("./session");
const { waitForCondition } = require("../utils/wait");

const runtime = {
  browser: null,
  cancelRequested: false,
  context: null,
  page: null,
  startedAt: null,
  status: "idle",
  lastError: null,
  lastSavedAt: null,
  loginUrl: null,
  monitorPromise: null
};

function getLoginUrl() {
  return process.env.CHATGPT_LOGIN_URL || "https://chatgpt.com/auth/login";
}

async function cleanupRuntime(logger) {
  if (runtime.page && !runtime.page.isClosed()) {
    await runtime.page.close().catch(() => {});
  }

  if (runtime.context) {
    await runtime.context.close().catch(() => {});
  }

  if (runtime.browser) {
    await runtime.browser.close().catch(() => {});
  }

  runtime.browser = null;
  runtime.cancelRequested = false;
  runtime.context = null;
  runtime.page = null;
  runtime.monitorPromise = null;
  logger?.info("Login session browser cleaned up");
}

async function isLoginComplete(page) {
  if (!page || page.isClosed()) {
    return false;
  }

  if (await isLoggedOut(page)) {
    return false;
  }

  return isAnyVisible(page, selectors.loginSuccessIndicators, { timeout: 1000 });
}

async function finalizeSuccessfulLogin(logger) {
  runtime.status = "saving";
  const sessionPath = await saveStorageState(runtime.context);
  runtime.lastSavedAt = new Date().toISOString();
  runtime.lastError = null;
  runtime.status = "ready";
  logger?.info({ sessionPath }, "Manual login completed and session saved");
  await cleanupRuntime(logger);
}

async function monitorLoginSession(logger) {
  const timeoutMs = Number(process.env.LOGIN_SESSION_TIMEOUT_MS || 900000);

  try {
    await waitForCondition(
      async () => {
        if (runtime.cancelRequested) {
          throw new Error("__login_cancelled__");
        }

        return isLoginComplete(runtime.page);
      },
      {
        timeoutMs,
        intervalMs: 1000,
        errorMessage:
          "Timed out waiting for manual login. Start a new login session and try again."
      }
    );

    await finalizeSuccessfulLogin(logger);
  } catch (error) {
    if (error.message === "__login_cancelled__") {
      logger?.info("Manual login session cancelled");
      return;
    }

    runtime.status = "error";
    runtime.lastError = error.message;
    logger?.error({ err: error }, "Manual login session failed");
    await cleanupRuntime(logger);
  }
}

async function getLoginSessionStatus(extra = {}) {
  return {
    status: runtime.status,
    started_at: runtime.startedAt,
    last_error: runtime.lastError,
    last_saved_at: runtime.lastSavedAt,
    login_url: runtime.loginUrl,
    session_file: getSessionFilePath(),
    session_file_exists: await sessionFileExists(),
    vnc_url: extra.vncUrl || null
  };
}

async function startLoginSession({ logger, vncUrl }) {
  if (runtime.status === "running" || runtime.status === "saving") {
    return getLoginSessionStatus({ vncUrl });
  }

  await ensureRuntimeDirectories();
  runtime.status = "running";
  runtime.startedAt = new Date().toISOString();
  runtime.cancelRequested = false;
  runtime.lastError = null;
  runtime.loginUrl = getLoginUrl();

  try {
    runtime.browser = await launchBrowser(
      {
        headless: false,
        startMinimized: false
      },
      logger
    );
    runtime.context = await runtime.browser.newContext();
    runtime.page = await runtime.context.newPage();

    const navigationTimeout = Number(process.env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS || 45000);
    runtime.page.setDefaultTimeout(navigationTimeout);
    runtime.page.setDefaultNavigationTimeout(navigationTimeout);

    await runtime.page.goto(runtime.loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeout
    });

    runtime.monitorPromise = monitorLoginSession(logger);
    logger?.info(
      { loginUrl: runtime.loginUrl, vncUrl },
      "Login session started. Open the VNC URL in your browser and complete login manually."
    );
    return getLoginSessionStatus({ vncUrl });
  } catch (error) {
    runtime.status = "error";
    runtime.lastError = error.message;
    await cleanupRuntime(logger);
    throw error;
  }
}

async function cancelLoginSession(logger) {
  if (runtime.status !== "running" && runtime.status !== "saving") {
    return getLoginSessionStatus();
  }

  runtime.cancelRequested = true;
  runtime.status = "idle";
  runtime.lastError = null;
  await cleanupRuntime(logger);
  return getLoginSessionStatus();
}

module.exports = {
  cancelLoginSession,
  getLoginSessionStatus,
  startLoginSession
};
