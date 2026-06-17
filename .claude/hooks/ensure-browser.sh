#!/bin/bash
# SessionStart hook — make sure a headless Chromium (Playwright) is available so
# browser-based verification (GIS map overlays, /verify, /run) works in Claude Code
# on the web. Background: prior sessions had no browser and could only GUESS at whether
# the FEMA / NWI map layers actually render (see BACKLOG B129). This guarantees the
# browser is present so future sessions can SEE the app.
#
# Resilient by design: every step is best-effort and the script ALWAYS exits 0, so a
# transient apt / CDN hiccup can never block a web session from starting. Do NOT add
# `set -e` here — a non-zero exit from any sub-step would defeat that guarantee.

# Web-only: local dev machines already have their own browser. Skip everything off-web.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# The base image ships two third-party apt sources (deadsnakes, ondrej/php) that 403
# because they're off the egress allowlist; that 403 aborts `apt-get update`, which in
# turn makes Playwright's dependency install treat the whole run as fatal. Removing them
# is THE fix that unblocked browser setup — keep it first.
rm -f /etc/apt/sources.list.d/*deadsnakes* /etc/apt/sources.list.d/*ondrej* 2>/dev/null

# Playwright honours PLAYWRIGHT_BROWSERS_PATH (this image sets it to /opt/pw-browsers);
# fall back to its default cache dir otherwise.
PW_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"

have_chromium() {
  ls "$PW_PATH"/chromium-*/chrome-linux/chrome >/dev/null 2>&1 || \
  ls "$PW_PATH"/chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell >/dev/null 2>&1
}

# Fast path: a Chromium build is already present (the base image ships one) — don't
# re-download on every session. Per request, only install when NONE exists.
if have_chromium; then
  echo "ensure-browser: Chromium already present in $PW_PATH — nothing to install."
  exit 0
fi

echo "ensure-browser: no Chromium in $PW_PATH — installing (best-effort)…"
apt-get update >/dev/null 2>&1 || true
# The only three shared libs this base image lacks for headless Chromium.
apt-get install -y libxcomposite1 libxdamage1 libxrandr2 >/dev/null 2>&1 || true
# Browser binary — downloads from cdn.playwright.dev (must be allowlisted in egress).
npx --yes playwright@latest install chromium >/dev/null 2>&1 || true

if have_chromium; then
  echo "ensure-browser: Chromium installed in $PW_PATH."
else
  echo "ensure-browser: Chromium NOT installed — verify cdn.playwright.dev is allowlisted (see BACKLOG B129 / STEP 0). Continuing; session not blocked."
fi
exit 0
