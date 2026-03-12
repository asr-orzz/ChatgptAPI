const { CloudflareChallengeError } = require("./errors");
const { selectors, getFirstVisibleLocator, isAnyVisible } = require("./selectors");
const { waitForCondition } = require("../utils/wait");

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

async function isCloudflareChallenge(page) {
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
  const timeoutMs = Number(process.env.CHATGPT_CHALLENGE_TIMEOUT_MS || 15000);
  const pollIntervalMs = 1000;

  if (!(await isCloudflareChallenge(page))) {
    return false;
  }

  logger?.warn(
    { headless, timeoutMs, url: page.url() },
    "Encountered Cloudflare verification before ChatGPT loaded"
  );

  try {
    await waitForCondition(
      async () => !(await isCloudflareChallenge(page)),
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
      "Cloudflare verification did not clear in the visible browser. Complete any verification in the browser window and try again.",
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
