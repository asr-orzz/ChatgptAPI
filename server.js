require("dotenv").config();

const path = require("path");
const express = require("express");
const { askChatGPT, ManualLoginRequiredError } = require("./src/chatgpt/ask");
const { closeSharedBrowser } = require("./src/chatgpt/browser");
const {
  deleteStorageState,
  exportStorageState,
  getStoredSessionStatus,
  importStorageState
} = require("./src/chatgpt/sessionTransfer");
const { createQueue } = require("./src/utils/queue");
const { createLogger } = require("./src/utils/logger");

const logger = createLogger("server");
const app = express();
const queueConcurrency = Number(process.env.CHATGPT_QUEUE_CONCURRENCY || 1);
const bodyLimit = process.env.REQUEST_BODY_LIMIT || "20mb";
const queue = createQueue({ concurrency: queueConcurrency, logger });

app.use(express.json({ limit: bodyLimit }));
app.use(express.static(path.join(process.cwd(), "public")));

app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    uptime_s: Math.round(process.uptime()),
    mode: "single-tenant-self-hosted",
    queue: {
      size: queue.size(),
      pending: queue.pending(),
      concurrency: queueConcurrency
    },
    session: await getStoredSessionStatus()
  });
});

app.get("/session/status", async (_req, res) => {
  res.json({
    ok: true,
    ...(await getStoredSessionStatus())
  });
});

app.post("/session/import", async (req, res) => {
  try {
    const imported = await importStorageState(req.body, logger);
    res.json({
      ok: true,
      message: "Cookies/session imported, verified, and saved.",
      ...imported,
      session_status: await getStoredSessionStatus()
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to import cookies/session");
    res.status(400).json({
      ok: false,
      error: error.message || "Failed to import cookies/session."
    });
  }
});

app.get("/session/export", async (_req, res) => {
  try {
    const exported = await exportStorageState();
    if (!exported) {
      res.status(404).json({
        ok: false,
        error: "No saved session exists."
      });
      return;
    }

    res.json({
      ok: true,
      ...exported
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to export session");
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to export session."
    });
  }
});

app.delete("/session", async (_req, res) => {
  try {
    const deleted = await deleteStorageState();
    res.json({
      ok: true,
      message: deleted.deleted ? "Saved session removed." : "No saved session existed.",
      ...deleted
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to delete session");
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to delete session."
    });
  }
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

app.use((error, _req, res, next) => {
  if (!error) {
    next();
    return;
  }

  if (error.type === "entity.too.large" || error.status === 413) {
    res.status(413).json({
      ok: false,
      error: `Upload is too large. Increase REQUEST_BODY_LIMIT or upload a smaller JSON file. Current limit: ${bodyLimit}.`
    });
    return;
  }

  if (error.type === "entity.parse.failed" || error instanceof SyntaxError) {
    res.status(400).json({
      ok: false,
      error: "Invalid JSON body."
    });
    return;
  }

  logger.error({ err: error }, "Unhandled request error");
  res.status(500).json({
    ok: false,
    error: "Unexpected server error."
  });
});

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => {
  logger.info(
    {
      port,
      bodyLimit,
      queueConcurrency
    },
    "Express API listening"
  );
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
