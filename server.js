require("dotenv").config();

const express = require("express");
const { askChatGPT, ManualLoginRequiredError } = require("./src/chatgpt/ask");
const { closeSharedBrowser } = require("./src/chatgpt/browser");
const { createQueue } = require("./src/utils/queue");
const { createLogger } = require("./src/utils/logger");

const logger = createLogger("server");
const app = express();
const queueConcurrency = Number(process.env.CHATGPT_QUEUE_CONCURRENCY || 1);
const queue = createQueue({ concurrency: queueConcurrency, logger });

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    uptime_s: Math.round(process.uptime()),
    queue: {
      size: queue.size(),
      pending: queue.pending(),
      concurrency: queueConcurrency
    }
  });
});

app.post("/ask", async (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";

  if (!prompt) {
    res.status(400).json({
      ok: false,
      error: "Request body must include a non-empty string field named \"prompt\"."
    });
    return;
  }

  try {
    const result = await queue.run(() => askChatGPT({ prompt, logger }));
    res.json({
      ok: true,
      answer: result.answer,
      timing_ms: result.timing_ms
    });
  } catch (error) {
    const statusCode = error instanceof ManualLoginRequiredError ? 401 : 500;
    logger.error({ err: error, promptLength: prompt.length }, "POST /ask failed");
    res.status(statusCode).json({
      ok: false,
      error: error.message || "Unknown error."
    });
  }
});

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => {
  logger.info({ port }, "Express API listening");
});

async function shutdown(signal) {
  logger.info({ signal }, "Shutting down");
  server.close(async () => {
    try {
      await closeSharedBrowser(logger);
    } catch (error) {
      logger.error({ err: error }, "Failed to close shared browser");
    } finally {
      process.exit(0);
    }
  });
}

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, () => {
    shutdown(signal);
  });
});
