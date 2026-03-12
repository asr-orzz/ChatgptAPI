#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
export PORT="${PORT:-3000}"
export ENABLE_XVFB="${ENABLE_XVFB:-true}"
export ENABLE_VNC="${ENABLE_VNC:-true}"
export XVFB_WHD="${XVFB_WHD:-1440x1024x24}"
export VNC_PORT="${VNC_PORT:-5900}"
export NOVNC_PORT="${NOVNC_PORT:-6080}"
export NOVNC_STATIC_DIR="${NOVNC_STATIC_DIR:-/usr/share/novnc}"

mkdir -p /app/sessions /app/debug /tmp/chatgpt-api

log() {
  printf '[start] %s\n' "$*"
}

stop_pid() {
  local pid="${1:-}"
  if [ -z "${pid}" ]; then
    return
  fi

  if kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
  fi
}

wait_for_tcp_port() {
  local host="$1"
  local port="$2"
  local timeout_seconds="${3:-10}"

  python3 - "${host}" "${port}" "${timeout_seconds}" <<'PY'
import socket
import sys
import time

host = sys.argv[1]
port = int(sys.argv[2])
timeout_seconds = float(sys.argv[3])
deadline = time.time() + timeout_seconds

while time.time() < deadline:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(0.5)
    try:
        sock.connect((host, port))
    except OSError:
        time.sleep(0.25)
    else:
        sock.close()
        sys.exit(0)
    finally:
        try:
            sock.close()
        except OSError:
            pass

sys.exit(1)
PY
}

display_socket_path() {
  local display_number="${DISPLAY#:}"
  display_number="${display_number%%.*}"
  printf '/tmp/.X11-unix/X%s' "${display_number}"
}

wait_for_display() {
  local socket_path
  socket_path="$(display_socket_path)"

  for attempt in $(seq 1 50); do
    if [ -S "${socket_path}" ]; then
      log "Display ${DISPLAY} is ready at ${socket_path}"
      return 0
    fi

    if [ -n "${XVFB_PID:-}" ] && ! kill -0 "${XVFB_PID}" 2>/dev/null; then
      log "Xvfb exited before the display socket became available"
      return 1
    fi

    sleep 0.2
  done

  log "Timed out waiting for display socket ${socket_path}"
  return 1
}

is_same_origin_novnc() {
  local same_origin="${NOVNC_SAME_ORIGIN:-false}"
  same_origin="${same_origin,,}"

  if [ "${same_origin}" = "true" ] || [ -n "${RENDER:-}" ]; then
    return 0
  fi

  return 1
}

should_start_websockify() {
  if is_same_origin_novnc && [ -d "${NOVNC_STATIC_DIR}" ]; then
    return 1
  fi

  return 0
}

start_x11vnc() {
  if [ -n "${VNC_PASSWORD:-}" ]; then
    x11vnc -storepasswd "${VNC_PASSWORD}" /tmp/chatgpt-api/x11vnc.pass > /dev/null 2>&1
    x11vnc \
      -display "${DISPLAY}" \
      -forever \
      -shared \
      -rfbport "${VNC_PORT}" \
      -rfbauth /tmp/chatgpt-api/x11vnc.pass \
      > /tmp/chatgpt-api/x11vnc.log 2>&1 &
  else
    x11vnc \
      -display "${DISPLAY}" \
      -forever \
      -shared \
      -nopw \
      -rfbport "${VNC_PORT}" \
      > /tmp/chatgpt-api/x11vnc.log 2>&1 &
  fi

  X11VNC_PID=$!
}

start_websockify() {
  websockify --web="${NOVNC_STATIC_DIR}/" "${NOVNC_PORT}" "localhost:${VNC_PORT}" > /tmp/chatgpt-api/novnc.log 2>&1 &
  WEBSOCKIFY_PID=$!
}

if [ "${ENABLE_XVFB}" = "true" ]; then
  log "Starting Xvfb on ${DISPLAY}"
  Xvfb "${DISPLAY}" -screen 0 "${XVFB_WHD}" -ac +extension RANDR > /tmp/chatgpt-api/xvfb.log 2>&1 &
  XVFB_PID=$!
  wait_for_display
  log "Starting fluxbox window manager"
  fluxbox > /tmp/chatgpt-api/fluxbox.log 2>&1 &
fi

if [ "${ENABLE_VNC}" = "true" ]; then
  if [ "${ENABLE_XVFB}" != "true" ]; then
    log "ENABLE_VNC=true without Xvfb; assuming DISPLAY ${DISPLAY} already exists"
  fi

  VNC_READY=false
  for attempt in $(seq 1 5); do
    log "Starting x11vnc (attempt ${attempt}/5)"
    start_x11vnc

    if wait_for_tcp_port "127.0.0.1" "${VNC_PORT}" 12; then
      VNC_READY=true
      log "x11vnc is listening on port ${VNC_PORT}"
      break
    fi

    log "x11vnc did not become ready; retrying"
    stop_pid "${X11VNC_PID:-}"
    sleep 1
  done

  if [ "${VNC_READY}" != "true" ]; then
    log "Failed to start x11vnc. Recent log output:"
    tail -n 80 /tmp/chatgpt-api/x11vnc.log || true
    exit 1
  fi

  if should_start_websockify; then
    NOVNC_READY=false
    for attempt in $(seq 1 3); do
      log "Starting standalone websockify (attempt ${attempt}/3)"
      start_websockify

      if wait_for_tcp_port "127.0.0.1" "${NOVNC_PORT}" 12; then
        NOVNC_READY=true
        log "websockify is listening on port ${NOVNC_PORT}"
        break
      fi

      log "websockify did not become ready; retrying"
      stop_pid "${WEBSOCKIFY_PID:-}"
      sleep 1
    done

    if [ "${NOVNC_READY}" != "true" ]; then
      log "Failed to start websockify. Recent log output:"
      tail -n 80 /tmp/chatgpt-api/novnc.log || true
      exit 1
    fi
  else
    log "Skipping standalone websockify because same-origin noVNC assets are served from ${NOVNC_STATIC_DIR}"
  fi
fi

exec node server.js
