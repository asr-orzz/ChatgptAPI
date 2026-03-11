function createQueue(options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency || 1));
  const logger = options.logger;
  const pending = [];
  let active = 0;

  async function drain() {
    if (active >= concurrency || pending.length === 0) {
      return;
    }

    const next = pending.shift();
    active += 1;
    logger?.debug({ active, queued: pending.length }, "Queue task started");

    try {
      const result = await next.task();
      next.resolve(result);
    } catch (error) {
      next.reject(error);
    } finally {
      active -= 1;
      logger?.debug({ active, queued: pending.length }, "Queue task finished");
      void drain();
    }
  }

  return {
    run(task) {
      return new Promise((resolve, reject) => {
        pending.push({ task, resolve, reject });
        logger?.debug({ active, queued: pending.length }, "Queue task added");
        void drain();
      });
    },
    size() {
      return pending.length;
    },
    pending() {
      return active;
    }
  };
}

module.exports = {
  createQueue
};
