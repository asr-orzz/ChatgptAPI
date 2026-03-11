const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const { closeSharedBrowser, getLaunchOptions, getSharedBrowser } = require("./browser");
const { selectors, getFirstVisibleLocator, isAnyVisible, waitForAnyVisible } = require("./selectors");
const {
  ensureRuntimeDirectories,
  getDebugDirectory,
  getSessionFilePath,
  sessionFileExists,
  verifySession
} = require("./session");
const { sleep, waitForCondition } = require("../utils/wait");

class ManualLoginRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "ManualLoginRequiredError";
  }
}

class CloudflareChallengeError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "CloudflareChallengeError";
    this.headless = Boolean(options.headless);
  }
}

function createTimings() {
  const start = performance.now();
  const timings = {
    startup: 0,
    navigation: 0,
    submission: 0,
    wait_for_response: 0,
    scrape: 0,
    total: 0
  };

  return {
    mark(key, value) {
      timings[key] = Math.max(0, Math.round(value));
    },
    finish() {
      timings.total = Math.max(0, Math.round(performance.now() - start));
      return timings;
    },
    sinceStart() {
      return performance.now() - start;
    }
  };
}

async function captureDebugArtifacts(page, label, logger) {
  if (!page || page.isClosed()) {
    return null;
  }

  await ensureRuntimeDirectories();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const basename = `${timestamp}-${label}`;
  const debugDirectory = getDebugDirectory();
  const screenshotPath = path.join(debugDirectory, `${basename}.png`);
  const htmlPath = path.join(debugDirectory, `${basename}.html`);

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await fs.promises.writeFile(htmlPath, await page.content(), "utf8");
    logger?.error({ screenshotPath, htmlPath, url: page.url() }, "Saved debug artifacts");
    return { screenshotPath, htmlPath };
  } catch (error) {
    logger?.error({ err: error }, "Failed to save debug artifacts");
    return null;
  }
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

async function getComposer(page) {
  return waitForAnyVisible(page, selectors.composerInputs, {
    timeout: Number(process.env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS || 45000)
  });
}

async function fillComposer(locator, prompt) {
  try {
    await locator.fill(prompt, { timeout: 10000 });
    return;
  } catch (_error) {
    await locator.click({ timeout: 5000 });
  }

  await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await locator.press("Backspace");
  await locator.type(prompt, { delay: 10 });
}

async function countAssistantMessages(page) {
  for (const selector of selectors.assistantMessages) {
    const locator = page.locator(selector);
    try {
      const count = await locator.count();
      if (count > 0) {
        return { selector, count };
      }
    } catch (_error) {
      continue;
    }
  }

  return { selector: selectors.assistantMessages[0], count: 0 };
}

async function getLatestAssistantText(page) {
  for (const selector of selectors.assistantMessages) {
    const locator = page.locator(selector);

    try {
      const count = await locator.count();
      if (count === 0) {
        continue;
      }

      const latest = locator.nth(count - 1);
      const text = (
        await latest.evaluate((node) => {
          const clone = node.cloneNode(true);
          clone
            .querySelectorAll("button, nav, svg, form, textarea, input, [aria-hidden='true']")
            .forEach((element) => element.remove());
          return clone.innerText || clone.textContent || "";
        })
      ).trim();
      if (text) {
        return { selector, text, count };
      }
    } catch (_error) {
      continue;
    }
  }

  return { selector: null, text: "", count: 0 };
}

async function submitPrompt(page, prompt, logger) {
  const composer = await getComposer(page);
  logger?.info({ selector: composer.selector }, "Submitting prompt");
  await fillComposer(composer.locator, prompt);

  const sendButton = await getFirstVisibleLocator(page, selectors.sendButtons, { timeout: 2000 });
  if (sendButton) {
    await sendButton.locator.click({ timeout: 5000 });
    return;
  }

  await composer.locator.press("Enter");
}

async function waitForAssistantResponse(page, beforeCount, logger) {
  const timeoutMs = Number(process.env.CHATGPT_RESPONSE_TIMEOUT_MS || 180000);
  const pollIntervalMs = Number(process.env.CHATGPT_STABILITY_POLL_INTERVAL_MS || 1000);
  const stablePollsRequired = Number(process.env.CHATGPT_STABILITY_POLLS || 3);

  logger?.info(
    { timeoutMs, pollIntervalMs, stablePollsRequired },
    "Waiting for the assistant response to finish streaming"
  );

  await waitForCondition(
    async () => {
      const snapshot = await getLatestAssistantText(page);
      return snapshot.count > beforeCount && snapshot.text.length > 0;
    },
    {
      timeoutMs: Math.min(timeoutMs, 60000),
      intervalMs: pollIntervalMs,
      errorMessage: "Timed out waiting for the assistant response to start."
    }
  );

  let stablePolls = 0;
  let previousText = "";
  let latestText = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const snapshot = await getLatestAssistantText(page);
    latestText = snapshot.text.trim();
    const stopVisible = await isAnyVisible(page, selectors.stopGeneratingButtons, {
      timeout: 500
    });

    if (latestText && latestText === previousText && !stopVisible) {
      stablePolls += 1;
      logger?.debug({ stablePolls, length: latestText.length }, "Assistant text is stable");
      if (stablePolls >= stablePollsRequired) {
        return latestText;
      }
    } else {
      stablePolls = 0;
      previousText = latestText;
    }

    await sleep(pollIntervalMs);
  }

  throw new Error("Timed out waiting for the assistant response to finish.");
}

async function runSingleAttempt({ prompt, logger, attempt, headless }) {
  const timings = createTimings();
  const sessionPath = getSessionFilePath();
  const navigationTimeout = Number(process.env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS || 45000);
  let context;
  let page;

  const startupStart = performance.now();
  const browser = await getSharedBrowser({ headless }, logger);
  context = await browser.newContext({ storageState: sessionPath });
  page = await context.newPage();
  page.setDefaultTimeout(navigationTimeout);
  page.setDefaultNavigationTimeout(navigationTimeout);
  timings.mark("startup", performance.now() - startupStart);

  try {
    const navigationStart = performance.now();
    await ensureFreshChat(page, { logger, headless });
    const sessionCheck = await verifySession(page, logger);
    if (!sessionCheck.valid) {
      throw new ManualLoginRequiredError(
        `${sessionCheck.reason} Run "npm run login" to refresh the saved session.`
      );
    }
    await getComposer(page);
    timings.mark("navigation", performance.now() - navigationStart);

    const submissionStart = performance.now();
    const beforeMessages = await countAssistantMessages(page);
    await submitPrompt(page, prompt, logger);
    timings.mark("submission", performance.now() - submissionStart);

    const waitStart = performance.now();
    const answer = await waitForAssistantResponse(page, beforeMessages.count, logger);
    timings.mark("wait_for_response", performance.now() - waitStart);

    const scrapeStart = performance.now();
    const latest = await getLatestAssistantText(page);
    const finalAnswer = latest.text || answer;
    timings.mark("scrape", performance.now() - scrapeStart);

    logger?.info(
      { attempt, answerLength: finalAnswer.length, totalMs: Math.round(timings.sinceStart()) },
      "Prompt completed"
    );

    return {
      answer: finalAnswer,
      timing_ms: timings.finish()
    };
  } catch (error) {
    await captureDebugArtifacts(page, `ask-attempt-${attempt}`, logger);
    throw error;
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

function isRetryable(error) {
  if (error instanceof ManualLoginRequiredError) {
    return false;
  }

  const message = String(error.message || "");
  return !/prompt/i.test(message) && !/non-empty/i.test(message);
}

async function askChatGPT({ prompt, logger }) {
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("Prompt must be a non-empty string.");
  }

  await ensureRuntimeDirectories();

  if (!(await sessionFileExists())) {
    throw new ManualLoginRequiredError(
      `No saved session found at ${getSessionFilePath()}. Run "npm run login" first.`
    );
  }

  let lastError;
  let headless = getLaunchOptions({}).headless;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      logger?.info({ attempt, promptLength: prompt.length, headless }, "Starting ChatGPT request");
      return await runSingleAttempt({ prompt: prompt.trim(), logger, attempt, headless });
    } catch (error) {
      lastError = error;
      logger?.warn({ err: error, attempt }, "ChatGPT request attempt failed");

      if (error instanceof CloudflareChallengeError && headless && attempt < 2) {
        logger?.warn("Retrying with a visible browser because the headless browser hit Cloudflare");
        await closeSharedBrowser(logger, { headless: true });
        headless = false;
        await sleep(1000);
        continue;
      }

      if (attempt === 2 || !isRetryable(error)) {
        break;
      }

      await sleep(1000);
    }
  }

  throw lastError;
}

module.exports = {
  askChatGPT,
  CloudflareChallengeError,
  ManualLoginRequiredError
};
