#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
export PORT="${PORT:-3000}"
export ENABLE_XVFB="${ENABLE_XVFB:-true}"
export ENABLE_VNC="${ENABLE_VNC:-true}"
export XVFB_WHD="${XVFB_WHD:-1440x1024x24}"
export VNC_PORT="${VNC_PORT:-5900}"
export NOVNC_PORT="${NOVNC_PORT:-6080}"

mkdir -p /app/sessions /app/debug /tmp/chatgpt-api

if [ "${ENABLE_XVFB}" = "true" ]; then
  Xvfb "${DISPLAY}" -screen 0 "${XVFB_WHD}" -ac +extension RANDR > /tmp/chatgpt-api/xvfb.log 2>&1 &
  fluxbox > /tmp/chatgpt-api/fluxbox.log 2>&1 &
fi

if [ "${ENABLE_VNC}" = "true" ]; then
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

  websockify --web=/usr/share/novnc/ "${NOVNC_PORT}" "localhost:${VNC_PORT}" > /tmp/chatgpt-api/novnc.log 2>&1 &
fi

exec node server.js
