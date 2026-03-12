const el = {
  token: document.getElementById("token"),
  sessionUpload: document.getElementById("session-upload"),
  sessionJson: document.getElementById("session-json"),
  prompt: document.getElementById("prompt"),
  status: document.getElementById("status-output"),
  ask: document.getElementById("ask-output"),
  notice: document.getElementById("notice-box"),
  timeline: document.getElementById("timeline"),
  diagnosticGrid: document.getElementById("diagnostic-grid"),
  statusWall: document.getElementById("status-wall"),
  linkMeta: document.getElementById("link-meta"),
  sessionFileText: document.getElementById("session-file-text"),
  metricAuth: document.getElementById("metric-auth"),
  metricSession: document.getElementById("metric-session"),
  metricStorage: document.getElementById("metric-storage"),
  metricQueue: document.getElementById("metric-queue"),
  heroMethod: document.getElementById("hero-method"),
  heroEvent: document.getElementById("hero-event"),
  heroStatus: document.getElementById("hero-status"),
  save: document.getElementById("save-token"),
  refresh: document.getElementById("refresh-status"),
  importSession: document.getElementById("import-session"),
  exportSession: document.getElementById("export-session"),
  clearSession: document.getElementById("clear-session"),
  send: document.getElementById("send-prompt")
};

const state = {
  health: null,
  login: null
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

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function statusTag(ok, warning = false) {
  if (ok) {
    return "good";
  }
  return warning ? "warn" : "bad";
}

function effectiveStatus(login) {
  if (login.session_file_exists === true && (login.status || "idle") === "idle") {
    return "saved";
  }

  return login.status || "idle";
}

function latestEvent(login) {
  if (login.last_error) {
    return login.last_error;
  }

  if (login.last_saved_at) {
    return `Session saved at ${formatTime(login.last_saved_at)}`;
  }

  if (login.started_at) {
    return `Remote login started at ${formatTime(login.started_at)}`;
  }

  return "No session activity yet.";
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json"
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function parseSessionEditor() {
  const raw = el.sessionJson.value.trim();
  if (!raw) {
    throw new Error("Paste a Playwright storage state JSON first.");
  }

  return JSON.parse(raw);
}

function render() {
  const health = state.health || {};
  const login = state.login || {};
  const remote = health.remote_browser || login.diagnostics || {};
  const summary = login.session_summary || {};
  const saved = login.session_file_exists === true;
  const authProtected = health.auth_required === true;
  const status = effectiveStatus(login);
  const hasChatGPTState =
    (summary.chatgpt_cookie_count || 0) > 0 || (summary.chatgpt_origin_count || 0) > 0;

  el.metricAuth.textContent = authProtected ? "Bearer token required" : "Open service";
  el.metricSession.textContent = saved ? "Saved session present" : "No saved session";
  el.metricStorage.textContent = saved
    ? `${summary.chatgpt_cookie_count || 0} ChatGPT cookies`
    : "Awaiting session import";
  el.metricQueue.textContent = health.queue
    ? `${health.queue.pending} pending / ${health.queue.concurrency} worker`
    : "Checking...";

  el.heroMethod.textContent = "Local login and session upload";
  el.heroEvent.textContent = latestEvent(login);
  el.heroStatus.textContent = status;

  el.statusWall.innerHTML = `
    <span class="pill status-${esc(status)}">${esc(status)}</span>
    <span class="pill">Auth: <strong>${esc(authProtected ? "protected" : "open")}</strong></span>
    <span class="pill">Session file: <strong>${esc(saved ? "present" : "missing")}</strong></span>
    <span class="pill">Legacy remote login: <strong>${esc(login.status || "idle")}</strong></span>
  `;

  el.linkMeta.innerHTML = `
    <span class="mini-pill">Saved at: <strong>${esc(formatTime(login.last_saved_at))}</strong></span>
    <span class="mini-pill">Size: <strong>${esc(formatBytes(login.session_file_size_bytes || 0))}</strong></span>
  `;

  el.sessionFileText.textContent = login.session_file || "Unknown";
  el.exportSession.disabled = !saved;
  el.clearSession.disabled = !saved;

  const steps = [
    {
      ok: Boolean(state.health),
      title: "Service is reachable",
      copy: state.health ? "The API is responding and the dashboard can query status." : "Waiting for /health."
    },
    {
      ok: saved,
      warning: !saved,
      title: "A storage state file is saved on the server",
      copy: saved
        ? `${login.session_file || "sessions/auth.json"} is present and ready to be reused.`
        : "Import a Playwright storage state JSON to create the saved session file."
    },
    {
      ok: hasChatGPTState,
      warning: saved && !hasChatGPTState,
      title: "The saved state contains ChatGPT/OpenAI data",
      copy: saved
        ? hasChatGPTState
          ? `${summary.chatgpt_cookie_count || 0} cookies and ${summary.chatgpt_origin_count || 0} origins match ChatGPT/OpenAI.`
          : "The file exists, but it does not look like a typical ChatGPT session state."
        : "No saved session exists yet."
    },
    {
      ok: login.status !== "error",
      warning: login.status === "idle",
      title: "No remote-login error is blocking session reuse",
      copy:
        login.status === "error"
          ? login.last_error || "The last remote login session failed."
          : login.status === "running" || login.status === "saving"
            ? "A legacy remote login flow is still running."
            : "No active noVNC login flow is required for this path."
    },
    {
      ok: saved,
      warning: !saved,
      title: "/ask can reuse the saved browser state",
      copy: saved
        ? "Send a prompt below to confirm the imported session works end to end."
        : "Save a session first, then test /ask."
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
    ["Session file", saved ? "present" : "missing", login.session_file || "unknown"],
    ["Saved at", formatTime(login.last_saved_at), formatBytes(login.session_file_size_bytes || 0)],
    ["Cookies", summary.cookie_count || 0, `${summary.chatgpt_cookie_count || 0} match ChatGPT/OpenAI`],
    ["Origins", summary.origin_count || 0, `${summary.chatgpt_origin_count || 0} match ChatGPT/OpenAI`],
    [
      "Queue",
      health.queue ? `${health.queue.pending} pending` : "n/a",
      health.queue ? `${health.queue.concurrency} worker(s)` : "waiting for /health"
    ],
    [
      "Legacy remote browser",
      remote.enabled === false ? "disabled" : remote.enabled === true ? "available" : "unknown",
      remote.enabled === true
        ? "Optional fallback only; noVNC is no longer required for the main flow."
        : "No remote browser required."
    ]
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
        ? "Health is reachable. Enter the bearer token to manage sessions or use /ask."
        : loginError.message,
      unauthorized ? "warn" : "bad"
    );
    el.status.textContent = JSON.stringify({ health, login_error: loginError.message }, null, 2);
    return;
  }

  if (!silent) {
    if (login.session_file_exists) {
      note("Saved session detected. You can call /ask, export it, replace it, or clear it.", "good");
    } else if (login.status === "error") {
      note(login.last_error || "The last remote login session failed.", "bad");
    } else {
      note("Upload or paste a Playwright storage state JSON to save a ChatGPT session without noVNC.", "neutral");
    }
  }
}

async function loadSessionFile(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  try {
    el.sessionJson.value = await file.text();
    note(`Loaded ${file.name}. Review the JSON and click import when ready.`, "good");
  } catch (error) {
    note(`Failed to read ${file.name}: ${error.message}`, "bad");
  }
}

async function importSession() {
  el.importSession.disabled = true;

  try {
    const storageState = parseSessionEditor();
    const response = await fetchJson("/session/import", {
      method: "POST",
      body: JSON.stringify(storageState)
    });

    state.login = response.login_status || state.login;
    await refreshStatus({ silent: true });
    note("Session imported, verified, and saved on the server.", "good");
  } catch (error) {
    note(error.message, "bad");
    el.status.textContent = error.message;
  } finally {
    el.importSession.disabled = false;
  }
}

async function exportSession() {
  el.exportSession.disabled = true;

  try {
    const response = await fetchJson("/session/export");
    el.sessionJson.value = JSON.stringify(response.storage_state, null, 2);
    downloadJson("chatgpt-session.json", response.storage_state);
    note("Saved session exported.", "good");
  } catch (error) {
    note(error.message, "bad");
    el.status.textContent = error.message;
  } finally {
    await refreshStatus({ silent: true });
  }
}

async function clearSession() {
  el.clearSession.disabled = true;

  try {
    await fetchJson("/session", { method: "DELETE" });
    note("Saved session cleared from the server.", "neutral");
    await refreshStatus({ silent: true });
  } catch (error) {
    note(error.message, "bad");
    el.status.textContent = error.message;
  } finally {
    el.clearSession.disabled = false;
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
el.sessionUpload.addEventListener("change", loadSessionFile);
el.importSession.addEventListener("click", importSession);
el.exportSession.addEventListener("click", exportSession);
el.clearSession.addEventListener("click", clearSession);
el.send.addEventListener("click", sendPrompt);

el.exportSession.disabled = true;
el.clearSession.disabled = true;

refreshStatus();
setInterval(() => refreshStatus({ silent: true }), 10000);
