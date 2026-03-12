require("dotenv").config();

const fs = require("fs");
const net = require("net");
const path = require("path");
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { WebSocket, WebSocketServer } = require("ws");
const { askChatGPT, ManualLoginRequiredError } = require("./src/chatgpt/ask");
const { closeSharedBrowser } = require("./src/chatgpt/browser");
const { cancelLoginSession, getLoginSessionStatus, startLoginSession } = require("./src/chatgpt/loginSession");
const { deleteStorageState, exportStorageState, importStorageState } = require("./src/chatgpt/sessionTransfer");
const { isApiTokenEnabled, requireApiToken } = require("./src/utils/auth");
const { createQueue } = require("./src/utils/queue");
const { createLogger } = require("./src/utils/logger");

const logger = createLogger("server");
const app = express();
const queueConcurrency = Number(process.env.CHATGPT_QUEUE_CONCURRENCY || 1);
const queue = createQueue({ concurrency: queueConcurrency, logger });
const vncPort = Number(process.env.VNC_PORT || 5900);
const noVncPort = Number(process.env.NOVNC_PORT || 6080);
const noVncPublicPort = Number(process.env.NOVNC_PUBLIC_PORT || process.env.NOVNC_PORT || 6080);
const display = String(process.env.DISPLAY || ":99");
const noVncSameOrigin =
  String(process.env.NOVNC_SAME_ORIGIN || "").toLowerCase() === "true" || Boolean(process.env.RENDER);
const noVncPrefix = "/novnc";
const noVncWsPath = "novnc/websockify";
const noVncStaticDir = process.env.NOVNC_STATIC_DIR || "/usr/share/novnc";
const noVncStaticMode = noVncSameOrigin
  ? fs.existsSync(noVncStaticDir)
    ? "filesystem"
    : "proxy"
  : "direct-port";

app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));

let noVncAssetProxy = null;
if (noVncSameOrigin && noVncStaticMode === "proxy") {
  const noVncTarget = `http://127.0.0.1:${noVncPort}`;
  noVncAssetProxy = createProxyMiddleware({
    target: noVncTarget,
    changeOrigin: false,
    ws: false,
    pathRewrite: (pathValue) => pathValue.replace(/^\/novnc/, ""),
    onError: (error, _req, res) => {
      logger.error({ err: error }, "noVNC asset proxy failed");
      if (res && typeof res.status === "function" && !res.headersSent) {
        res.status(502).json({
          ok: false,
          error: "Remote browser assets are unavailable. Ensure noVNC is running."
        });
      }
    }
  });
}

if (noVncSameOrigin) {
  app.use(noVncPrefix, (req, res, next) => {
    res.set("Cache-Control", "no-cache");
    next();
  });

  if (noVncStaticMode === "filesystem") {
    app.use(noVncPrefix, express.static(noVncStaticDir, { index: false }));
  } else if (noVncAssetProxy) {
    app.use(noVncPrefix, noVncAssetProxy);
  }
}

app.use(express.static(path.join(process.cwd(), "public")));

function isVncEnabled() {
  return String(process.env.ENABLE_VNC ?? "true").toLowerCase() === "true";
}

function getDisplaySocketPath(displayValue) {
  const trimmed = String(displayValue || "").trim();
  if (!trimmed) {
    return null;
  }

  const displayNumber = trimmed.replace(/^:/, "").split(".")[0];
  if (!displayNumber) {
    return null;
  }

  return `/tmp/.X11-unix/X${displayNumber}`;
}

function checkTcpPort(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    if (!Number.isFinite(port) || port <= 0) {
      resolve(false);
      return;
    }

    const socket = net.connect({
      host: "127.0.0.1",
      port
    });

    let settled = false;
    const finish = (isReachable) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(isReachable);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function getRemoteBrowserDiagnostics() {
  const displaySocketPath = getDisplaySocketPath(display);
  return {
    enabled: isVncEnabled(),
    display,
    display_socket: displaySocketPath,
    display_socket_ready: displaySocketPath ? fs.existsSync(displaySocketPath) : null,
    same_origin: noVncSameOrigin,
    static_assets: noVncStaticMode,
    static_dir: noVncStaticMode === "filesystem" ? noVncStaticDir : null,
    websocket_path: noVncSameOrigin ? `/${noVncWsPath}` : "/websockify",
    vnc_port: vncPort,
    novnc_port: noVncSameOrigin ? noVncPort : noVncPublicPort,
    vnc_tcp_reachable: isVncEnabled() ? await checkTcpPort(vncPort) : false,
    novnc_tcp_reachable:
      noVncSameOrigin && noVncStaticMode !== "proxy" ? null : await checkTcpPort(noVncPort)
  };
}

function isLoopbackHost(hostname) {
  const lower = (hostname || "").toLowerCase();
  return lower === "localhost" || lower === "127.0.0.1" || lower === "::1";
}

function resolveBaseUrl(req) {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const hostHeader = req.headers["x-forwarded-host"] || req.get("host");
  const inferredBaseUrl = `${protocol}://${hostHeader}`;
  const configuredBaseUrl = (process.env.PUBLIC_BASE_URL || "").trim();

  if (!configuredBaseUrl) {
    return inferredBaseUrl;
  }

  try {
    const configuredUrl = new URL(configuredBaseUrl);
    const inferredUrl = new URL(inferredBaseUrl);
    const configuredIsLoopback = isLoopbackHost(configuredUrl.hostname);
    const inferredIsLoopback = isLoopbackHost(inferredUrl.hostname);
    if (
      configuredIsLoopback &&
      (!inferredIsLoopback ||
        configuredUrl.host !== inferredUrl.host ||
        configuredUrl.protocol !== inferredUrl.protocol)
    ) {
      return inferredBaseUrl;
    }
    return configuredUrl.toString();
  } catch (error) {
    logger.warn({ err: error, configuredBaseUrl }, "Invalid PUBLIC_BASE_URL, using request host");
    return inferredBaseUrl;
  }
}

function buildNoVncUrl(req) {
  const url = new URL(resolveBaseUrl(req));
  if (noVncSameOrigin) {
    url.pathname = `${noVncPrefix}/vnc.html`;
    url.search = `autoconnect=1&resize=scale&view_only=0&path=${encodeURIComponent(noVncWsPath)}`;
    return url.toString();
  }

  url.port = String(noVncPublicPort);
  url.pathname = "/vnc.html";
  url.search = "autoconnect=1&resize=scale&view_only=0";
  return url.toString();
}

function attachVncWebSocketBridge(server) {
  if (!noVncSameOrigin || !isVncEnabled()) {
    return;
  }

  const wsPath = `/${noVncWsPath}`;
  const vncBridge = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false
  });

  vncBridge.on("connection", (client, req) => {
    const upstream = net.createConnection({
      host: "127.0.0.1",
      port: vncPort
    });

    upstream.setNoDelay(true);

    const closeClient = (code, reason) => {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close(code, reason);
      }
    };

    upstream.once("connect", () => {
      logger.info({ url: req.url, vncPort }, "noVNC websocket connected to VNC backend");
    });

    upstream.on("data", (chunk) => {
      if (client.readyState !== WebSocket.OPEN) {
        return;
      }

      client.send(chunk, { binary: true }, (error) => {
        if (error) {
          logger.error({ err: error }, "Failed sending VNC frame to browser");
          upstream.destroy();
        }
      });
    });

    upstream.on("error", (error) => {
      logger.error({ err: error, vncPort }, "Failed connecting to VNC backend");
      closeClient(1011, "VNC backend unavailable");
    });

    upstream.on("close", () => {
      closeClient(1000, "VNC connection closed");
    });

    upstream.on("end", () => {
      closeClient(1000, "VNC connection ended");
    });

    client.on("message", (data, isBinary) => {
      if (upstream.destroyed) {
        return;
      }

      upstream.write(isBinary ? data : Buffer.from(data));
    });

    client.on("close", () => {
      upstream.end();
    });

    client.on("error", (error) => {
      logger.error({ err: error }, "Browser websocket to noVNC bridge failed");
      upstream.destroy();
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (requestUrl.pathname !== wsPath) {
      socket.destroy();
      return;
    }

    vncBridge.handleUpgrade(req, socket, head, (client) => {
      vncBridge.emit("connection", client, req);
    });
  });
}

app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    uptime_s: Math.round(process.uptime()),
    mode: "single-tenant-self-hosted",
    auth_required: isApiTokenEnabled(),
    queue: {
      size: queue.size(),
      pending: queue.pending(),
      concurrency: queueConcurrency
    },
    remote_browser: await getRemoteBrowserDiagnostics()
  });
});

app.get("/login/status", requireApiToken, async (req, res) => {
  res.json({
    ok: true,
    ...(await getLoginSessionStatus({
      diagnostics: await getRemoteBrowserDiagnostics(),
      vncUrl: buildNoVncUrl(req)
    }))
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

app.post("/session/import", requireApiToken, async (req, res) => {
  try {
    await cancelLoginSession(logger);
    const imported = await importStorageState(req.body, logger);
    res.json({
      ok: true,
      message: "Session imported, verified, and saved.",
      ...imported,
      login_status: await getLoginSessionStatus({
        diagnostics: await getRemoteBrowserDiagnostics()
      })
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to import session");
    res.status(400).json({
      ok: false,
      error: error.message || "Failed to import session."
    });
  }
});

app.get("/session/export", requireApiToken, async (_req, res) => {
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

app.delete("/session", requireApiToken, async (_req, res) => {
  try {
    await cancelLoginSession(logger);
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
      noVncPort: noVncPublicPort,
      noVncSameOrigin,
      noVncStaticMode,
      vncPort
    },
    "Express API listening"
  );
});

attachVncWebSocketBridge(server);

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
