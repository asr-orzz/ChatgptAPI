require("dotenv").config();

const { launchBrowser } = require("./browser");
const { selectors, waitForAnyVisible, isAnyVisible } = require("./selectors");
const {
  ensureRuntimeDirectories,
  saveStorageState,
  isLoggedOut,
  getSessionFilePath
} = require("./session");
const { createLogger } = require("../utils/logger");
const { waitForCondition } = require("../utils/wait");

const logger = createLogger("login");

async function waitForManualLogin(page, loggerInstance) {
  const timeout = Number(process.env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS || 45000) * 4;

  loggerInstance.info(
    { timeoutMs: timeout },
    "Complete login manually in the opened browser window. No credentials are handled by code."
  );

  await waitForCondition(
    async () => {
      if (await isLoggedOut(page)) {
        return false;
      }

      return isAnyVisible(page, selectors.loginSuccessIndicators, { timeout: 1000 });
    },
    {
      timeoutMs: timeout,
      intervalMs: 1000,
      errorMessage: "Timed out waiting for manual login to complete."
    }
  );
}

async function run() {
  await ensureRuntimeDirectories();

  const browser = await launchBrowser(
    {
      headless:
        process.env.PLAYWRIGHT_LOGIN_HEADLESS === undefined
          ? false
          : process.env.PLAYWRIGHT_LOGIN_HEADLESS,
      startMinimized: false
    },
    logger
  );

  const context = await browser.newContext();
  const page = await context.newPage();
  const loginUrl = process.env.CHATGPT_LOGIN_URL || "https://chatgpt.com/auth/login";
  const navigationTimeout = Number(process.env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS || 45000);

  page.setDefaultTimeout(navigationTimeout);
  page.setDefaultNavigationTimeout(navigationTimeout);

  try {
    logger.info({ loginUrl }, "Opening ChatGPT login page");
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

    try {
      await waitForAnyVisible(page, [...selectors.loggedOutIndicators, ...selectors.loginSuccessIndicators], {
        timeout: navigationTimeout
      });
    } catch (_error) {
      logger.warn("Login page markers were not found quickly; continuing with manual login wait");
    }

    await waitForManualLogin(page, logger);
    const sessionPath = await saveStorageState(context);
    logger.info({ sessionPath }, "Login detected and session saved");
    console.log(`Session saved to ${sessionPath}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  logger.error({ err: error, sessionFile: getSessionFilePath() }, "Manual login flow failed");
  console.error(error.message);
  process.exit(1);
});
