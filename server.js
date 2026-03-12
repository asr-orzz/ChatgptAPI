require("dotenv").config();

const path = require("path");
const express = require("express");
const { askChatGPT, ManualLoginRequiredError } = require("./src/chatgpt/ask");
const { closeSharedBrowser } = require("./src/chatgpt/browser");
const { cancelLoginSession, getLoginSessionStatus, startLoginSession } = require("./src/chatgpt/loginSession");
const { isApiTokenEnabled, requireApiToken } = require("./src/utils/auth");
const { createQueue } = require("./src/utils/queue");
const { createLogger } = require("./src/utils/logger");

const logger = createLogger("server");
const app = express();
const queueConcurrency = Number(process.env.CHATGPT_QUEUE_CONCURRENCY || 1);
const queue = createQueue({ concurrency: queueConcurrency, logger });

app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(process.cwd(), "public")));

function buildNoVncUrl(req) {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const hostHeader = req.headers["x-forwarded-host"] || req.get("host");
  const baseUrl = publicBaseUrl || `${protocol}://${hostHeader}`;
  const url = new URL(baseUrl);
  url.port = String(process.env.NOVNC_PUBLIC_PORT || process.env.NOVNC_PORT || 6080);
  url.pathname = "/vnc.html";
  url.search = "autoconnect=1&resize=scale&view_only=0";
  return url.toString();
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    uptime_s: Math.round(process.uptime()),
    mode: "single-tenant-self-hosted",
    auth_required: isApiTokenEnabled(),
    queue: {
      size: queue.size(),
      pending: queue.pending(),
      concurrency: queueConcurrency
    }
  });
});

app.get("/login/status", requireApiToken, async (req, res) => {
  res.json({
    ok: true,
    ...(await getLoginSessionStatus({ vncUrl: buildNoVncUrl(req) }))
  });
});

app.post("/login/start", requireApiToken, async (req, res) => {
  try {
    const status = await startLoginSession({
      logger,
      vncUrl: buildNoVncUrl(req)
    });
    res.json({
      ok: true,
      message:
        "Login session started. Open the VNC URL in your browser, complete ChatGPT login manually, and the server will save the session automatically.",
      ...status
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to start login session");
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to start login session."
    });
  }
});

app.post("/login/cancel", requireApiToken, async (_req, res) => {
  try {
    const status = await cancelLoginSession(logger);
    res.json({
      ok: true,
      message: "Login session cancelled.",
      ...status
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to cancel login session");
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to cancel login session."
    });
  }
});

app.post("/ask", requireApiToken, async (req, res) => {
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
  logger.info(
    {
      port,
      authRequired: isApiTokenEnabled(),
      noVncPort: process.env.NOVNC_PUBLIC_PORT || process.env.NOVNC_PORT || 6080
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
