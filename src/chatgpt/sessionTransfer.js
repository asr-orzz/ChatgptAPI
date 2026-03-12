const { closeSharedBrowser, getLaunchOptions, getSharedBrowser } = require("./browser");
const { CloudflareChallengeError } = require("./errors");
const { ensureFreshChat } = require("./page");
const {
  clearStorageState,
  getSessionFileMetadata,
  getSessionFilePath,
  normalizeStorageState,
  readStorageState,
  summarizeStorageState,
  verifySession,
  writeStorageState
} = require("./session");

async function getStoredSessionStatus() {
  const metadata = await getSessionFileMetadata();
  let storageState = null;
  let lastError = null;

  if (metadata.exists) {
    try {
      storageState = await readStorageState();
    } catch (error) {
      lastError = error.message;
    }
  }

  return {
    status: !metadata.exists ? "empty" : lastError ? "invalid" : "saved",
    last_error: lastError,
    last_saved_at: metadata.updated_at,
    session_file: getSessionFilePath(),
    session_file_exists: metadata.exists,
    session_file_size_bytes: metadata.size_bytes,
    session_summary: storageState ? summarizeStorageState(storageState) : null
  };
}

async function runSessionVerification({ storageState, headless, logger }) {
  const navigationTimeout = Number(process.env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS || 45000);
  let context;
  let page;

  try {
    const browser = await getSharedBrowser({ headless }, logger);
    context = await browser.newContext({ storageState });
    page = await context.newPage();
    page.setDefaultTimeout(navigationTimeout);
    page.setDefaultNavigationTimeout(navigationTimeout);

    await ensureFreshChat(page, { logger, headless });
    const result = await verifySession(page, logger);
    if (!result.valid) {
      throw new Error(result.reason || "Unable to verify the imported session.");
    }
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

async function verifyImportedSession(storageState, logger) {
  let headless = getLaunchOptions({}).headless;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await runSessionVerification({ storageState, headless, logger });
      return {
        headless_used: headless
      };
    } catch (error) {
      logger?.warn({ err: error, attempt, headless }, "Imported session verification failed");

      if (error instanceof CloudflareChallengeError && headless && attempt < 2) {
        logger?.warn("Retrying imported session verification in a visible browser");
        await closeSharedBrowser(logger, { headless: true });
        headless = false;
        continue;
      }

      throw error;
    }
  }

  return {
    headless_used: headless
  };
}

async function importStorageState(rawValue, logger) {
  const storageState = normalizeStorageState(rawValue);
  const sessionPath = await writeStorageState(storageState);
  const metadata = await getSessionFileMetadata();

  logger?.info(
    {
      sessionPath,
      cookieCount: storageState.cookies.length,
      originCount: storageState.origins.length
    },
    "Cookies/session saved without upfront verification"
  );

  return {
    saved: true,
    session_file: sessionPath,
    session_summary: summarizeStorageState(storageState),
    session_metadata: metadata
  };
}

async function exportStorageState() {
  const storageState = await readStorageState();
  if (!storageState) {
    return null;
  }

  return {
    session_file: getSessionFilePath(),
    session_summary: summarizeStorageState(storageState),
    session_metadata: await getSessionFileMetadata(),
    storage_state: storageState
  };
}

async function deleteStorageState() {
  const existed = (await getSessionFileMetadata()).exists;
  await clearStorageState();
  return {
    deleted: existed,
    session_file: getSessionFilePath()
  };
}

module.exports = {
  deleteStorageState,
  exportStorageState,
  getStoredSessionStatus,
  importStorageState,
  verifyImportedSession
};
