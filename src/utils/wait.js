function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(predicate, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 30000);
  const intervalMs = Number(options.intervalMs || 250);
  const errorMessage = options.errorMessage || `Timed out after ${timeoutMs}ms`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) {
      return result;
    }

    await sleep(intervalMs);
  }

  throw new Error(errorMessage);
}

module.exports = {
  sleep,
  waitForCondition
};
