const selectors = {
  loginSuccessIndicators: [
    "#prompt-textarea",
    "[data-testid='composer-text-input']",
    "div.ProseMirror[contenteditable='true']",
    "button[data-testid='create-new-chat-button']",
    "button[aria-label*='New chat' i]",
    "a[aria-label*='New chat' i]",
    "button[data-testid='profile-button']"
  ],
  loggedOutIndicators: [
    "a[href*='/auth/login']",
    "button:has-text('Log in')",
    "a:has-text('Log in')",
    "button:has-text('Sign up')",
    "a:has-text('Sign up')",
    "input[type='email']",
    "form[action*='login']"
  ],
  challengeIndicators: [
    "text=Just a moment...",
    "text=Enable JavaScript and cookies to continue",
    "text=Verification successful. Waiting for chatgpt.com to respond",
    "#challenge-error-text",
    "input[name='cf-turnstile-response']",
    "iframe[src*='turnstile']"
  ],
  newChatButtons: [
    "button[data-testid='create-new-chat-button']",
    "button[aria-label*='New chat' i]",
    "a[aria-label*='New chat' i]",
    "button:has-text('New chat')",
    "a:has-text('New chat')",
    "nav a[href='/']"
  ],
  composerInputs: [
    "#prompt-textarea",
    "[data-testid='composer-text-input']",
    "textarea[placeholder*='Message']",
    "textarea[placeholder*='Ask']",
    "div.ProseMirror[contenteditable='true']"
  ],
  sendButtons: [
    "button[data-testid='send-button']",
    "button[aria-label*='Send' i]",
    "button:has-text('Send')"
  ],
  assistantMessages: [
    "[data-message-author-role='assistant']",
    "article [data-message-author-role='assistant']",
    "main article:has([data-message-author-role='assistant'])"
  ],
  stopGeneratingButtons: [
    "button[data-testid='stop-button']",
    "button[aria-label*='Stop generating' i]",
    "button:has-text('Stop generating')",
    "button:has-text('Stop')"
  ],
  modalCloseButtons: [
    "button[aria-label='Close']",
    "button[aria-label='Dismiss']",
    "button:has-text('Close')",
    "button:has-text('Dismiss')",
    "button:has-text('Not now')",
    "button:has-text('Maybe later')",
    "button:has-text('Continue')"
  ]
};

async function getFirstVisibleLocator(page, selectorList, options = {}) {
  const timeout = Number(options.timeout || 2000);

  for (const selector of selectorList) {
    const locator = page.locator(selector).first();

    try {
      if (await locator.isVisible({ timeout })) {
        return { selector, locator };
      }
    } catch (_error) {
      continue;
    }
  }

  return null;
}

async function waitForAnyVisible(page, selectorList, options = {}) {
  const timeout = Number(options.timeout || 15000);
  const pollInterval = Number(options.pollInterval || 250);
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const found = await getFirstVisibleLocator(page, selectorList, { timeout: 250 });
    if (found) {
      return found;
    }

    await page.waitForTimeout(pollInterval);
  }

  throw new Error(
    `Timed out after ${timeout}ms waiting for any selector: ${selectorList.join(", ")}`
  );
}

async function isAnyVisible(page, selectorList, options = {}) {
  return Boolean(await getFirstVisibleLocator(page, selectorList, options));
}

module.exports = {
  selectors,
  getFirstVisibleLocator,
  isAnyVisible,
  waitForAnyVisible
};
