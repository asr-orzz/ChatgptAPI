const el = {
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
  metricSession: document.getElementById("metric-session"),
  metricCookies: document.getElementById("metric-cookies"),
  metricQueue: document.getElementById("metric-queue"),
  heroMethod: document.getElementById("hero-method"),
  heroEvent: document.getElementById("hero-event"),
  heroStatus: document.getElementById("hero-status"),
  refresh: document.getElementById("refresh-status"),
  importSession: document.getElementById("import-session"),
  clearSession: document.getElementById("clear-session"),
  send: document.getElementById("send-prompt")
};

const state = {
  health: null,
  session: null
};

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
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

function latestEvent(session) {
  if (session.last_error) {
    return session.last_error;
  }

  if (session.last_saved_at) {
    return `Session saved at ${formatTime(session.last_saved_at)}`;
  }

  return "No session activity yet.";
}

function parseSessionEditor() {
  const raw = el.sessionJson.value.trim();
  if (!raw) {
    throw new Error("Paste cookie JSON or session JSON first.");
  }

  return JSON.parse(raw);
}

function render() {
  const health = state.health || {};
  const session = state.session || {};
  const summary = session.session_summary || {};
  const saved = session.session_file_exists === true;

  el.metricSession.textContent = saved ? "Saved session present" : "No saved session";
  el.metricCookies.textContent = saved
    ? `${summary.chatgpt_cookie_count || 0} matched cookies`
    : "Awaiting import";
  el.metricQueue.textContent = health.queue
    ? `${health.queue.pending} pending / ${health.queue.concurrency} worker`
    : "Checking...";

  el.heroMethod.textContent = "Cookie JSON or storage-state JSON";
  el.heroEvent.textContent = latestEvent(session);
  el.heroStatus.textContent = session.status || "checking";

  el.statusWall.innerHTML = `
    <span class="pill status-${esc(session.status || "idle")}">${esc(session.status || "unknown")}</span>
    <span class="pill">Session file: <strong>${esc(saved ? "present" : "missing")}</strong></span>
    <span class="pill">ChatGPT cookies: <strong>${esc(summary.chatgpt_cookie_count || 0)}</strong></span>
  `;

  el.linkMeta.innerHTML = `
    <span class="mini-pill">Saved at: <strong>${esc(formatTime(session.last_saved_at))}</strong></span>
    <span class="mini-pill">Size: <strong>${esc(formatBytes(session.session_file_size_bytes || 0))}</strong></span>
  `;

  el.sessionFileText.textContent = session.session_file || "Unknown";
  el.clearSession.disabled = !saved;

  const steps = [
    {
      ok: Boolean(state.health),
      title: "Service is reachable",
      copy: state.health ? "The API is responding." : "Waiting for /health."
    },
    {
      ok: saved,
      warning: !saved,
      title: "A saved session exists on the server",
      copy: saved
        ? `${session.session_file || "sessions/auth.json"} is present and ready to reuse.`
        : "Upload cookie JSON or session JSON and import it."
    },
    {
      ok: (summary.chatgpt_cookie_count || 0) > 0,
      warning: saved && (summary.chatgpt_cookie_count || 0) === 0,
      title: "The saved state contains ChatGPT/OpenAI cookies",
      copy: saved
        ? `${summary.chatgpt_cookie_count || 0} matching cookies and ${summary.chatgpt_origin_count || 0} matching origins were detected.`
        : "No saved session exists yet."
    },
    {
      ok: session.status === "saved",
      warning: session.status === "empty",
      title: "The saved session file exists for /ask",
      copy:
        session.status === "saved"
          ? "Send a prompt below to check whether the uploaded cookies are still valid."
          : session.last_error || "Import valid cookie/session JSON so the server can save it."
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
    ["Session status", session.status || "unknown", session.last_error || "No session error"],
    ["Session file", saved ? "present" : "missing", session.session_file || "unknown"],
    ["Saved at", formatTime(session.last_saved_at), formatBytes(session.session_file_size_bytes || 0)],
    ["Cookies", summary.cookie_count || 0, `${summary.chatgpt_cookie_count || 0} match ChatGPT/OpenAI`],
    ["Origins", summary.origin_count || 0, `${summary.chatgpt_origin_count || 0} match ChatGPT/OpenAI`],
    [
      "Queue",
      health.queue ? `${health.queue.pending} pending` : "n/a",
      health.queue ? `${health.queue.concurrency} worker(s)` : "waiting for /health"
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

  el.status.textContent = JSON.stringify({ health, session }, null, 2);
}

async function refreshStatus({ silent = false } = {}) {
  let health;
  let session;

  try {
    [health, session] = await Promise.all([fetchJson("/health"), fetchJson("/session/status")]);
  } catch (error) {
    el.status.textContent = error.message;
    note(error.message, "bad");
    return;
  }

  state.health = health;
  state.session = session;
  render();

  if (!silent) {
    if (session.status === "saved") {
      note("Session file saved on the server. Now test /ask.", "good");
    } else if (session.status === "invalid") {
      note(session.last_error || "The saved session file is invalid.", "bad");
    } else {
      note("Upload cookie JSON or session JSON and import it.", "neutral");
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
    note(`Loaded ${file.name}. Click import to save it.`, "good");
  } catch (error) {
    note(`Failed to read ${file.name}: ${error.message}`, "bad");
  }
}

async function importSession() {
  el.importSession.disabled = true;

  try {
    const payload = parseSessionEditor();
    const response = await fetchJson("/session/import", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    state.session = response.session_status || state.session;
    await refreshStatus({ silent: true });
    note("Cookies/session saved on the server.", "good");
  } catch (error) {
    note(error.message, "bad");
    el.status.textContent = error.message;
  } finally {
    el.importSession.disabled = false;
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

el.sessionUpload.addEventListener("change", loadSessionFile);
el.importSession.addEventListener("click", importSession);
el.clearSession.addEventListener("click", clearSession);
el.refresh.addEventListener("click", () => refreshStatus());
el.send.addEventListener("click", sendPrompt);

el.clearSession.disabled = true;

refreshStatus();
setInterval(() => refreshStatus({ silent: true }), 10000);
