// AI agent access, sign-in fix (owner-approved mockup 2026-11-27): an AI agent's browser is pointed at the emailed
// code up front (Moment 1), a failed / hung / never-loaded check says "Using an AI agent?" and promotes the code
// (Moment 2), and the code box leads the sent screen (Moment 3). The bot check itself is never loosened.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { agentBrowserReason, detectAgentBrowser } from "../src/shared/auth/agentBrowser.js";
import { AGENT_BROWSER_COPY, BLOCKED_CHECK_COPY, EMAIL_CODE_BUTTON, CODE_COPY } from "../src/workspaces/site-planner/lib/emailLinkCopy.js";

// source-scan: the panel layout rules are wiring (which control renders in which state); e2e/auth-agent-browser.spec.js drives the same rules in a real browser.
const panel = readFileSync(new URL("../src/workspaces/site-planner/components/AuthPanel.jsx", import.meta.url), "utf8");
const sent = readFileSync(new URL("../src/workspaces/site-planner/components/EmailLinkSent.jsx", import.meta.url), "utf8");

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

describe("agentBrowserReason", () => {
  it("names the Claude app's browser by its own user-agent token, even with webdriver false", () => {
    expect(agentBrowserReason({ userAgent: "Claude/1.2.3 " + CHROME, webdriver: false })).toBe("claude");
    expect(agentBrowserReason({ userAgent: CHROME + " Claude/0.9", webdriver: false })).toBe("claude");
    expect(agentBrowserReason({ userAgent: "Mozilla/5.0 (Macintosh; Claude/2.0) Safari", webdriver: false })).toBe("claude");
  });
  it("flags an automated browser (webdriver true) and a headless one", () => {
    expect(agentBrowserReason({ userAgent: CHROME, webdriver: true })).toBe("automated");
    expect(agentBrowserReason({ userAgent: CHROME.replace("Chrome/", "HeadlessChrome/"), webdriver: false })).toBe("headless");
  });
  it("leaves ordinary browsers alone, including ones that merely mention Claude in other words", () => {
    expect(agentBrowserReason({ userAgent: CHROME, webdriver: false })).toBe(null);
    expect(agentBrowserReason({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1" })).toBe(null);
    expect(agentBrowserReason({ userAgent: CHROME + " ClaudeBrowserFan", webdriver: false })).toBe(null);
    expect(agentBrowserReason({ userAgent: CHROME + " MyClaude/1.0", webdriver: false })).toBe(null);
    expect(agentBrowserReason({ userAgent: "", webdriver: undefined })).toBe(null);
    expect(agentBrowserReason()).toBe(null);
  });
  it("never throws on a hostile navigator", () => {
    expect(detectAgentBrowser(null)).toBe(null);
    const nav = {}; Object.defineProperty(nav, "userAgent", { get() { throw new Error("nope"); } });
    expect(detectAgentBrowser(nav)).toBe(null);
    expect(detectAgentBrowser({ userAgent: "Claude/1.0", webdriver: false })).toBe("claude");
  });
});

describe("the copy", () => {
  it("says the approved words, plain, and points at the code", () => {
    expect(AGENT_BROWSER_COPY.heading).toBe("Using an AI agent?");
    expect(AGENT_BROWSER_COPY.body).toMatch(/6-digit code/);
    expect(EMAIL_CODE_BUTTON).toBe("Email me a sign-in code");
    expect(BLOCKED_CHECK_COPY.heading).toMatch(/didn.t finish/);
    expect(CODE_COPY.agent).toMatch(/only for a sign-in you just started/);
    for (const t of [AGENT_BROWSER_COPY.body, BLOCKED_CHECK_COPY.body, CODE_COPY.agent]) expect(t).not.toMatch(/captcha|turnstile|webdriver|user.agent/i);
  });
});

describe("AuthPanel wiring", () => {
  it("the agent layout only exists where the check is on, on the Sign in tab, and can be left for the password form", () => {
    expect(panel).toMatch(/const agentLayout = captchaOn && mode === "signin" && !!agentReason && !agentWantsPassword;/);
    expect(panel).toContain('data-testid="agent-browser-note"');
    expect(panel).toContain('data-testid="agent-use-password"');
    expect(panel).toMatch(/onClick=\{\(\) => setAgentWantsPassword\(true\)\}/);
  });
  it("in the agent layout there is no password field, no check widget, no dead Sign in button, and Enter sends the code", () => {
    expect(panel).toMatch(/mode !== "reset" && !agentLayout && \(\s*<input aria-label="Password"/);
    expect(panel).toMatch(/captchaOn && !agentLayout && \(/);
    expect(panel).toMatch(/\{!agentLayout && <button ref=\{submitRef\}/);
    expect(panel).toMatch(/onFormSubmit = \(e\) => \{ e\.preventDefault\(\); if \(agentLayout\) onEmailLink\(\); else submit\(\); \}/);
  });
  it("the code button is primary whenever the check is blocked OR this is an agent's browser", () => {
    expect(panel).toMatch(/const codeFirst = captchaBlocked \|\| agentLayout;/);
    expect(panel).toMatch(/btn\(codeFirst\)/);
    expect(panel).toContain("{busy ? \"…\" : EMAIL_CODE_BUTTON}");
  });
  it("a failed or timed-out check (Turnstile.jsx already times out a hung script) promotes the code with the agent wording", () => {
    expect(panel).toMatch(/captchaBlocked \? \(\s*<div role="alert" data-testid="captcha-unavailable" data-blocked="true"/);
    expect(panel).toContain("{BLOCKED_CHECK_COPY.heading}");
    expect(panel).toContain("{BLOCKED_CHECK_COPY.retry}");
  });
  it("the bot check is not loosened: sign-up and password sign-in still send a token", () => {
    expect(panel).toMatch(/gate\.submit\(\{ needsToken: captchaOn \}\)/);
    expect(panel).not.toMatch(/agentReason[^\n]*needsToken/);
  });
});

describe("EmailLinkSent: code first for sign-in", () => {
  it("renders the code form right after the inbox line, before the link details", () => {
    const iInbox = sent.indexOf('data-testid="email-link-inbox"');
    const iCode = sent.indexOf("{codeForm}");
    const iValid = sent.indexOf("{c.valid}", iInbox);
    expect(iInbox).toBeGreaterThan(0);
    expect(iCode).toBeGreaterThan(iInbox);
    expect(iValid).toBeGreaterThan(iCode);
    expect(sent).toContain('data-testid="email-code-agent-note"');
    expect(sent).toMatch(/const codeForm = onVerifyCode && \(/); // reset (no onVerifyCode) keeps the link-only view
  });
});

describe("the sign-in email warns against handing the code to someone else's agent", async () => {
  const { buildAuthEmail, CODE_SHARE_WARNING } = await import("../functions/api/lib/authEmail.js");
  it("text and HTML both carry the warning, right with the code; reset and code-less mails do not", () => {
    const m = buildAuthEmail({ kind: "signin", link: "https://planyr.io/?app&authlink=x", code: "654321" });
    expect(m.text).toContain("654321");
    expect(m.text).toContain(CODE_SHARE_WARNING);
    expect(m.text.indexOf(CODE_SHARE_WARNING)).toBeGreaterThan(m.text.indexOf("654321"));
    expect(m.html).toContain("Only give this code to an AI assistant you are using yourself");
    expect(CODE_SHARE_WARNING).toMatch(/never ask you for it/);
    expect(buildAuthEmail({ kind: "signin", link: "https://planyr.io/x" }).text).not.toContain(CODE_SHARE_WARNING);
    expect(buildAuthEmail({ kind: "reset", link: "https://planyr.io/x", code: "654321" }).text).not.toContain(CODE_SHARE_WARNING);
  });
});
