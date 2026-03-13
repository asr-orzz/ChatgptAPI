const { CloudflareChallengeError } = require("./errors");
const { selectors, getFirstVisibleLocator, isAnyVisible } = require("./selectors");
const { waitForCondition } = require("../utils/wait");

function getChallengeTimeoutMs(headless) {
  const configuredDefaultTimeout = Number(process.env.CHATGPT_CHALLENGE_TIMEOUT_MS);
  const configuredVisibleTimeout = Number(process.env.CHATGPT_VISIBLE_CHALLENGE_TIMEOUT_MS);

  if (headless) {
    return Number.isFinite(configuredDefaultTimeout) && configuredDefaultTimeout > 0
      ? configuredDefaultTimeout
      : 15000;
  }

  if (Number.isFinite(configuredVisibleTimeout) && configuredVisibleTimeout > 0) {
    return configuredVisibleTimeout;
  }

  if (Number.isFinite(configuredDefaultTimeout) && configuredDefaultTimeout > 0) {
    return Math.max(configuredDefaultTimeout, 300000);
  }

  return 300000;
}

async function closeTransientModals(page, logger) {
  for (const selector of selectors.modalCloseButtons) {
    const locator = page.locator(selector).first();

    try {
      if (await locator.isVisible({ timeout: 500 })) {
        logger?.info({ selector }, "Closing visible modal");
        await locator.click({ timeout: 2000 });
        await page.waitForTimeout(250);
      }
    } catch (_error) {
      continue;
    }
  }
}

async function isChatReady(page) {
  return isAnyVisible(page, selectors.loginSuccessIndicators, { timeout: 750 });
}

async function isCloudflareChallenge(page) {
  if (await isChatReady(page)) {
    return false;
  }

  if (await isAnyVisible(page, selectors.challengeIndicators, { timeout: 750 })) {
    return true;
  }

  try {
    const title = await page.title();
    if (/just a moment/i.test(title)) {
      return true;
    }
  } catch (_error) {
    return false;
  }

  return false;
}

async function waitForChallengeToClear(page, { headless, logger }) {
  const timeoutMs = getChallengeTimeoutMs(headless);
  const pollIntervalMs = 1000;

  if (!(await isCloudflareChallenge(page))) {
    return false;
  }

  logger?.warn(
    { headless, timeoutMs, url: page.url() },
    "Encountered Cloudflare verification before ChatGPT loaded"
  );

  if (!headless) {
    logger?.info(
      { timeoutMs },
      "Waiting for Cloudflare verification to clear in the visible browser window"
    );
    await page.bringToFront().catch(() => {});
  }

  try {
    await waitForCondition(
      async () => (await isChatReady(page)) || !(await isCloudflareChallenge(page)),
      {
        timeoutMs,
        intervalMs: pollIntervalMs,
        errorMessage: "Timed out waiting for Cloudflare verification to clear."
      }
    );
    logger?.info("Cloudflare verification cleared");
    return true;
  } catch (_error) {
    if (headless) {
      throw new CloudflareChallengeError(
        "Cloudflare blocked the headless browser before ChatGPT loaded.",
        { headless }
      );
    }

    throw new CloudflareChallengeError(
      `Cloudflare verification did not clear in the visible browser within ${Math.round(timeoutMs / 1000)} seconds. Complete any verification in the opened browser window and try again.`,
      { headless }
    );
  }
}

async function ensureFreshChat(page, { logger, headless }) {
  const baseUrl = process.env.CHATGPT_BASE_URL || "https://chatgpt.com";
  const navigationTimeout = Number(process.env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS || 45000);

  logger?.info({ baseUrl }, "Navigating to ChatGPT");
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
  await waitForChallengeToClear(page, { headless, logger });
  await closeTransientModals(page, logger);

  const newChat = await getFirstVisibleLocator(page, selectors.newChatButtons, {
    timeout: 2000
  });

  if (newChat) {
    logger?.info({ selector: newChat.selector }, "Starting a fresh chat");
    await newChat.locator.click({ timeout: 5000 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);
    await waitForChallengeToClear(page, { headless, logger });
    await closeTransientModals(page, logger);
    return;
  }

  logger?.info("New chat button not found; relying on the base URL state");
}

module.exports = {
  closeTransientModals,
  ensureFreshChat,
  isCloudflareChallenge,
  waitForChallengeToClear
};
