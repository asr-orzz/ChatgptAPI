#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
export PORT="${PORT:-3000}"
export ENABLE_XVFB="${ENABLE_XVFB:-true}"
export XVFB_WHD="${XVFB_WHD:-1440x1024x24}"

mkdir -p /app/sessions /app/debug /tmp/chatgpt-api

log() {
  printf '[start] %s\n' "$*"
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

if [ "${ENABLE_XVFB}" = "true" ]; then
  log "Starting Xvfb on ${DISPLAY}"
  Xvfb "${DISPLAY}" -screen 0 "${XVFB_WHD}" -ac +extension RANDR > /tmp/chatgpt-api/xvfb.log 2>&1 &
  XVFB_PID=$!
  wait_for_display
  log "Starting fluxbox window manager"
  fluxbox > /tmp/chatgpt-api/fluxbox.log 2>&1 &
fi

exec node server.js
