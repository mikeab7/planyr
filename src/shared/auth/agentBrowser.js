/* Is this sign-in panel running inside an AI agent's browser? (NEW-1, 2026-11-27, owner-approved mockup
 * "AI agent access", Moment 1.)
 *
 * Why it matters: Cloudflare Turnstile (the hidden security check on the password form) refuses these
 * browsers even when a real person ticks the box, so the password route is a dead end there. The emailed
 * sign-in code (functions/api/auth/email-link.js + EmailLinkSent.jsx) does not need the check, so when this
 * answers non-null the panel leads with that route. It NEVER loosens the check itself: it only changes which
 * button is primary and what the note says (the owner rejected weakening the bot check, 2026-11-27).
 *
 * Signals, strongest first:
 *   "claude"    — the Claude app's built-in browser names itself: a user-agent token "Claude/<version>".
 *                 navigator.webdriver is FALSE there, so the name is the only tell.
 *   "automated" — navigator.webdriver === true (Playwright, Selenium, Puppeteer and the agent tools built on them).
 *   "headless"  — a headless browser's own name (HeadlessChrome).
 * Pure: pass { userAgent, webdriver }; `detectAgentBrowser()` reads the real navigator. */

export const AGENT_REASONS = Object.freeze(["claude", "automated", "headless"]);

export function agentBrowserReason({ userAgent = "", webdriver = false } = {}) {
  const ua = String(userAgent || "");
  if (/(^|[\s(;])Claude\/\d/.test(ua)) return "claude";
  if (webdriver === true) return "automated";
  if (/HeadlessChrome\//.test(ua)) return "headless";
  return null;
}

export function detectAgentBrowser(nav = typeof navigator !== "undefined" ? navigator : null) {
  if (!nav) return null;
  try { return agentBrowserReason({ userAgent: nav.userAgent, webdriver: nav.webdriver }); }
  catch (_) { return null; }
}
