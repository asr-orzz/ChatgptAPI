const fs = require("fs");
const { chromium } = require("playwright");

const sharedBrowserPromises = new Map();

function toBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value).toLowerCase() === "true";
}

function getLaunchOptions(overrides = {}) {
  const channel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined;
  const runningInContainer = process.platform === "linux" && fs.existsSync("/.dockerenv");
  const requestedHeadless = toBoolean(
    overrides.headless,
    toBoolean(process.env.PLAYWRIGHT_HEADLESS, true)
  );
  const hasDisplay =
    process.platform !== "linux" || Boolean(String(process.env.DISPLAY || "").trim());
  const headless = requestedHeadless || runningInContainer || Boolean(process.env.RENDER) || !hasDisplay;
  const startMinimized = toBoolean(
    overrides.startMinimized,
    toBoolean(process.env.PLAYWRIGHT_START_MINIMIZED, true)
  );
  const slowMo = Number(process.env.PLAYWRIGHT_SLOW_MO || 0);
  const disableSandbox = toBoolean(
    process.env.PLAYWRIGHT_DISABLE_SANDBOX,
    runningInContainer || Boolean(process.env.RENDER)
  );
  const args = [
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--no-default-browser-check",
    "--disable-notifications"
  ];

  if (disableSandbox) {
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  }

  if (!headless && startMinimized) {
    args.push("--start-minimized");
  }

  const launchOptions = {
    headless,
    slowMo,
    channel,
    args
  };

  if (channel === undefined) {
    delete launchOptions.channel;
  }

  return launchOptions;
}

function getBrowserCacheKey(overrides = {}) {
  const options = getLaunchOptions(overrides);
  return JSON.stringify({
    channel: options.channel || "",
    headless: options.headless,
    slowMo: options.slowMo
  });
}

async function launchBrowser(overrides = {}, logger) {
  const launchOptions = getLaunchOptions(overrides);
  logger?.info(
    {
      headless: launchOptions.headless,
      slowMo: launchOptions.slowMo,
      channel: launchOptions.channel || "bundled-chromium"
    },
    "Launching browser"
  );
  return chromium.launch(launchOptions);
}

async function getSharedBrowser(overrides = {}, logger) {
  const cacheKey = getBrowserCacheKey(overrides);

  if (!sharedBrowserPromises.has(cacheKey)) {
    const browserPromise = launchBrowser(overrides, logger).catch((error) => {
      sharedBrowserPromises.delete(cacheKey);
      throw error;
    });
    sharedBrowserPromises.set(cacheKey, browserPromise);
  }

  return sharedBrowserPromises.get(cacheKey);
}

async function closeSharedBrowser(logger, overrides) {
  const specificCacheKey = overrides ? getBrowserCacheKey(overrides) : null;
  const closePromises = [];

  for (const [cacheKey, browserPromise] of sharedBrowserPromises.entries()) {
    if (specificCacheKey && cacheKey !== specificCacheKey) {
      continue;
    }

    closePromises.push(
      (async () => {
        try {
          const browser = await browserPromise;
          logger?.info({ cacheKey }, "Closing shared browser");
          await browser.close();
        } finally {
          sharedBrowserPromises.delete(cacheKey);
        }
      })()
    );
  }

  if (closePromises.length > 0) {
    await Promise.allSettled(closePromises);
  }
}

module.exports = {
  closeSharedBrowser,
  getLaunchOptions,
  getSharedBrowser,
  launchBrowser
};
