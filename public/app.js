const el = {
  token: document.getElementById("token"),
  prompt: document.getElementById("prompt"),
  status: document.getElementById("status-output"),
  ask: document.getElementById("ask-output"),
  notice: document.getElementById("notice-box"),
  timeline: document.getElementById("timeline"),
  diagnosticGrid: document.getElementById("diagnostic-grid"),
  statusWall: document.getElementById("status-wall"),
  linkMeta: document.getElementById("link-meta"),
  vncText: document.getElementById("vnc-link-text"),
  metricAuth: document.getElementById("metric-auth"),
  metricBridge: document.getElementById("metric-bridge"),
  metricSession: document.getElementById("metric-session"),
  metricQueue: document.getElementById("metric-queue"),
  heroRemote: document.getElementById("hero-remote"),
  heroEvent: document.getElementById("hero-event"),
  heroStatus: document.getElementById("hero-status"),
  save: document.getElementById("save-token"),
  refresh: document.getElementById("refresh-status"),
  start: document.getElementById("start-login"),
  cancel: document.getElementById("cancel-login"),
  loadPreview: document.getElementById("load-preview"),
  open: document.getElementById("open-remote-browser"),
  copy: document.getElementById("copy-remote-link"),
  send: document.getElementById("send-prompt"),
  previewMode: document.getElementById("preview-mode"),
  previewFrame: document.getElementById("remote-browser-frame"),
  previewShell: document.getElementById("remote-frame"),
  emptyTitle: document.getElementById("empty-title"),
  emptyCopy: document.getElementById("empty-copy")
};

const state = {
  health: null,
  login: null,
  previewLoaded: false,
  previewUrl: ""
};

el.token.value = localStorage.getItem("chatgpt_api_token") || "";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function headers() {
  const token = el.token.value.trim();
  const base = { "Content-Type": "application/json" };
  if (token) {
    base.Authorization = `Bearer ${token}`;
  }
  return base;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {})
    }
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Request failed with status ${response.status}`);
  }

  return body;
}

function note(text, tone = "neutral") {
  el.notice.className = `notice ${tone}`;
  el.notice.textContent = text;
}

function formatTime(value) {
  if (!value) {
    return "Not yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function boolText(value) {
  if (value === true) {
    return "Ready";
  }
  if (value === false) {
    return "Down";
  }
  return "n/a";
}

function statusTag(ok, warning = false) {
  if (ok) {
    return "good";
  }
  return warning ? "warn" : "bad";
}

function sessionSummary(status, login) {
  if (status === "ready") {
    return `Saved on ${formatTime(login.last_saved_at)}`;
  }
  if (status === "error") {
    return login.last_error || "Login session failed.";
  }
  if (status === "running" || status === "saving") {
    return `Started ${formatTime(login.started_at)}`;
  }
  return "No saved login yet";
}

function latestEvent(status, login) {
  if (status === "ready") {
    return `Session saved at ${formatTime(login.last_saved_at)}`;
  }
  if (status === "error") {
    return login.last_error || "Session failed";
  }
  if (status === "running" || status === "saving") {
    return `Session active since ${formatTime(login.started_at)}`;
  }
  return "No session activity yet.";
}

function ensurePreview(url) {
  if (!url) {
    return;
  }

  if (state.previewLoaded && state.previewUrl === url) {
    return;
  }

  state.previewLoaded = true;
  state.previewUrl = url;
  el.previewFrame.src = url;
  render();
}

function clearPreview() {
  state.previewLoaded = false;
  state.previewUrl = "";
  el.previewFrame.removeAttribute("src");
  render();
}

function render() {
  const health = state.health || {};
  const login = state.login || {};
  const diag = login.diagnostics || health.remote_browser || {};
  const status = login.status || "idle";
  const remoteLink = login.vnc_url || "";
  const vncReady = diag.vnc_tcp_reachable === true;
  const displayReady = diag.display_socket_ready === true;
  const sameOrigin = diag.same_origin !== false;
  const previewAvailable = Boolean(remoteLink);
  const sessionReady = login.session_file_exists === true || status === "ready";
  const activeLogin = status === "running" || status === "saving";
  const authProtected = health.auth_required === true;

  if (state.previewLoaded && remoteLink && state.previewUrl !== remoteLink) {
    state.previewUrl = remoteLink;
    el.previewFrame.src = remoteLink;
  }

  el.metricAuth.textContent = authProtected ? "Bearer token required" : "Open service";
  el.metricBridge.textContent = vncReady ? "VNC backend online" : "VNC backend unavailable";
  el.metricSession.textContent = sessionReady ? "Saved session present" : "No saved session";
  el.metricQueue.textContent = health.queue
    ? `${health.queue.pending} pending / ${health.queue.concurrency} worker`
    : "Checking...";

  el.heroRemote.textContent = sameOrigin ? "Same-origin noVNC through this app" : "Direct-port noVNC link";
  el.heroEvent.textContent = latestEvent(status, login);
  el.heroStatus.textContent = status === "idle" ? "Idle" : status;

  el.statusWall.innerHTML = `
    <span class="pill status-${esc(status)}">${esc(status)}</span>
    <span class="pill">Auth: <strong>${esc(authProtected ? "protected" : "open")}</strong></span>
    <span class="pill">Display: <strong>${esc(displayReady ? "ready" : "missing")}</strong></span>
    <span class="pill">VNC: <strong>${esc(vncReady ? "live" : "down")}</strong></span>
  `;

  el.linkMeta.innerHTML = `
    <span class="mini-pill">Session file: <strong>${esc(login.session_file || "Unknown")}</strong></span>
    <span class="mini-pill">Saved at: <strong>${esc(formatTime(login.last_saved_at))}</strong></span>
  `;

  if (remoteLink) {
    el.vncText.innerHTML = `<a href="${esc(remoteLink)}" target="_blank" rel="noreferrer">${esc(remoteLink)}</a>`;
  } else {
    el.vncText.textContent = "No remote browser link yet.";
  }

  el.start.disabled = activeLogin;
  el.cancel.disabled = !activeLogin;
  el.open.disabled = !previewAvailable;
  el.copy.disabled = !previewAvailable;
  el.loadPreview.disabled = !previewAvailable;

  el.previewMode.textContent = state.previewLoaded ? "Preview live" : "Preview idle";
  el.previewShell.classList.toggle("loaded", state.previewLoaded);

  if (state.previewLoaded) {
    el.emptyTitle.textContent = "Preview loaded";
    el.emptyCopy.textContent =
      "If the canvas still stays black or frozen, use the diagnostics cards below to see whether the display, VNC port, or noVNC bridge is missing.";
  } else if (previewAvailable) {
    el.emptyTitle.textContent = "Remote browser ready to load";
    el.emptyCopy.textContent =
      "Use “Load Inline Browser” to bring noVNC into this page, or open the same link in a new tab if you prefer.";
  } else {
    el.emptyTitle.textContent = "Preview not loaded";
    el.emptyCopy.textContent =
      "Start a login session, then load the inline remote browser here. If the preview stays blank, check the diagnostics panel under it.";
  }

  const steps = [
    {
      ok: displayReady,
      warning: diag.display_socket_ready == null,
      title: "Virtual display is available",
      copy:
        diag.display_socket_ready === true
          ? `${diag.display || ":99"} is live and ready for GUI apps.`
          : diag.display_socket_ready === false
            ? `${diag.display || ":99"} is missing, so Chromium has no desktop to open on.`
            : "Display readiness is not available yet."
    },
    {
      ok: vncReady,
      title: "VNC backend answers on the local port",
      copy: vncReady
        ? `Port ${diag.vnc_port || "5900"} is listening inside the container.`
        : `Port ${diag.vnc_port || "5900"} is not answering, so noVNC has nothing to display.`
    },
    {
      ok: sameOrigin || diag.novnc_tcp_reachable === true,
      warning: sameOrigin,
      title: "Remote browser console is published",
      copy: sameOrigin
        ? `noVNC is served through this app at ${diag.websocket_path || "/novnc/websockify"}.`
        : diag.novnc_tcp_reachable === true
          ? `Port ${diag.novnc_port || "6080"} is reachable.`
          : `Port ${diag.novnc_port || "6080"} is not reachable.`
    },
    {
      ok: activeLogin || status === "ready",
      warning: status === "idle",
      title: "Login browser session exists",
      copy:
        activeLogin
          ? "The remote browser is active. Finish ChatGPT login there."
          : status === "ready"
            ? "The remote login already completed and the session is saved."
            : status === "error"
              ? login.last_error || "The login browser failed."
              : "Start a login session to launch the remote browser."
    },
    {
      ok: sessionReady,
      title: "Saved ChatGPT session is available",
      copy: sessionReady ? "Storage state is present and can be reused by /ask." : "No saved ChatGPT session exists yet."
    }
  ];

  el.timeline.innerHTML = steps
    .map((step, index) => {
      const tone = statusTag(step.ok, step.warning);
      const label = step.ok ? "Pass" : step.warning ? "Info" : "Fail";
      return `
        <div class="timeline-item">
          <div class="timeline-top">
            <div class="timeline-title">${index + 1}. ${esc(step.title)}</div>
            <span class="tag ${tone}">${esc(label)}</span>
          </div>
          <p class="timeline-copy">${esc(step.copy)}</p>
        </div>
      `;
    })
    .join("");

  const diagnostics = [
    ["Display socket", boolText(diag.display_socket_ready), diag.display_socket || diag.display || "unknown"],
    ["VNC port", boolText(diag.vnc_tcp_reachable), diag.vnc_port || "5900"],
    ["noVNC mode", sameOrigin ? "same-origin" : "direct-port", diag.static_assets || "unknown"],
    ["WebSocket path", diag.websocket_path || "unknown", "remote browser websocket"],
    ["Login session", status, sessionSummary(status, login)],
    ["Saved session file", sessionReady ? "present" : "missing", login.session_file || "unknown"]
  ];

  el.diagnosticGrid.innerHTML = diagnostics
    .map(
      ([label, value, helper]) => `
        <div class="stat">
          <span>${esc(label)}</span>
          <strong>${esc(value)}</strong>
          <p class="helper">${esc(helper)}</p>
        </div>
      `
    )
    .join("");

  el.status.textContent = JSON.stringify({ health, login }, null, 2);
}

async function refreshStatus({ silent = false } = {}) {
  let health;
  let login;
  let loginError = null;

  try {
    health = await fetchJson("/health");
  } catch (error) {
    el.status.textContent = error.message;
    note(error.message, "bad");
    return;
  }

  try {
    login = await fetchJson("/login/status");
  } catch (error) {
    loginError = error;
  }

  state.health = health;
  if (login) {
    state.login = login;
  }

  render();

  if (loginError) {
    const unauthorized = /Unauthorized/i.test(loginError.message);
    note(
      unauthorized
        ? "Health is reachable. Enter the bearer token to manage login or use /ask."
        : loginError.message,
      unauthorized ? "warn" : "bad"
    );
    el.status.textContent = JSON.stringify({ health, login_error: loginError.message }, null, 2);
    return;
  }

  const status = login.status || "idle";
  const diag = login.diagnostics || health.remote_browser || {};

  if ((status === "running" || status === "saving") && login.vnc_url && !state.previewLoaded) {
    ensurePreview(login.vnc_url);
  }

  if (!silent) {
    if (status === "ready") {
      note("Manual login completed and the session is saved.", "good");
    } else if (status === "error") {
      note(login.last_error || "Login session failed.", "bad");
    } else if (diag.vnc_tcp_reachable === false) {
      note("The service is up, but the VNC backend is not answering inside the container.", "bad");
    } else if (status === "running" || status === "saving") {
      note("Remote browser session is active. Finish the ChatGPT login in the inline preview or a new tab.", "warn");
    } else {
      note("Service is reachable. Start a login session when you want to refresh the ChatGPT session.", "neutral");
    }
  }
}

async function startLogin() {
  el.start.disabled = true;
  try {
    const response = await fetchJson("/login/start", { method: "POST" });
    state.login = response;
    if (response.vnc_url) {
      ensurePreview(response.vnc_url);
    }
    await refreshStatus({ silent: true });
    note("Login session started. The remote browser is available below and can also be opened in a new tab.", "warn");
  } catch (error) {
    note(error.message, "bad");
    el.status.textContent = error.message;
  } finally {
    el.start.disabled = false;
  }
}

async function cancelLogin() {
  el.cancel.disabled = true;
  try {
    await fetchJson("/login/cancel", { method: "POST" });
    clearPreview();
    await refreshStatus({ silent: true });
    note("Login session cancelled.", "neutral");
  } catch (error) {
    note(error.message, "bad");
    el.status.textContent = error.message;
  } finally {
    el.cancel.disabled = false;
  }
}

function loadPreview() {
  if (!state.login?.vnc_url) {
    note("No remote browser link is available yet.", "warn");
    return;
  }
  ensurePreview(state.login.vnc_url);
  note("Inline remote browser loaded.", "good");
}

function openRemote() {
  if (!state.login?.vnc_url) {
    note("No remote browser link is available yet.", "warn");
    return;
  }
  window.open(state.login.vnc_url, "_blank", "noopener,noreferrer");
}

async function copyRemote() {
  if (!state.login?.vnc_url) {
    note("No remote browser link is available yet.", "warn");
    return;
  }

  try {
    await navigator.clipboard.writeText(state.login.vnc_url);
    note("Remote browser link copied.", "good");
  } catch (error) {
    note(`Failed to copy the link: ${error.message}`, "bad");
  }
}

async function sendPrompt() {
  el.send.disabled = true;
  el.ask.textContent = "Waiting for response...";

  try {
    const response = await fetchJson("/ask", {
      method: "POST",
      body: JSON.stringify({ prompt: el.prompt.value })
    });
    el.ask.textContent = JSON.stringify(response, null, 2);
    note("Prompt completed.", "good");
  } catch (error) {
    el.ask.textContent = error.message;
    note(error.message, "bad");
  } finally {
    el.send.disabled = false;
  }
}

el.save.addEventListener("click", () => {
  localStorage.setItem("chatgpt_api_token", el.token.value.trim());
  note("Token stored in this browser only.", "good");
  refreshStatus({ silent: true });
});
el.refresh.addEventListener("click", () => refreshStatus());
el.start.addEventListener("click", startLogin);
el.cancel.addEventListener("click", cancelLogin);
el.loadPreview.addEventListener("click", loadPreview);
el.open.addEventListener("click", openRemote);
el.copy.addEventListener("click", copyRemote);
el.send.addEventListener("click", sendPrompt);

el.open.disabled = true;
el.copy.disabled = true;
el.loadPreview.disabled = true;

refreshStatus();
setInterval(() => refreshStatus({ silent: true }), 10000);
