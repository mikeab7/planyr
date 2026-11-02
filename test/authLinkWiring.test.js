/* NEW-1 — structural guards for the emailed-link flow: the properties a future edit could quietly break while every
 * visual test stays green (there is no jsdom here; the rendered behaviour is e2e/auth-email-link.spec.js). */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const walk = (d, out = []) => { for (const f of readdirSync(join(root, d))) { const r = join(d, f); if (statSync(join(root, r)).isDirectory()) walk(r, out); else if (/\.(jsx?|mjs)$/.test(f)) out.push(r); } return out; };

const landing = read("src/app/AuthLinkLanding.jsx");
const panel = read("src/workspaces/site-planner/components/AuthPanel.jsx");
const shell = read("src/app/Shell.jsx");
const client = read("src/workspaces/site-planner/lib/emailLinkClient.js");
const route = read("functions/api/auth/email-link.js");

describe("the link is spent only by the button press", () => {
  it("verifyAuthLink has exactly ONE call site and it is inside the press handler, never an effect", () => {
    expect(landing.match(/verifyAuthLink\(/g)).toHaveLength(1);
    const at = landing.indexOf("verifyAuthLink(");
    const handler = landing.lastIndexOf("const spend = async", at);
    expect(handler).toBeGreaterThan(-1);
    expect(landing.slice(handler, at)).not.toMatch(/useEffect/);
    // no effect body ever mentions spend()/verify
    for (const m of landing.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[/g)) expect(m[1]).not.toMatch(/spend\(|verifyAuthLink/);
  });
  it("verifyOtp is called in one place in the whole app, and only with a token hash", () => {
    const hits = walk("src").filter((f) => /\.verifyOtp\(/.test(read(f)));
    expect(hits).toEqual(["src/workspaces/site-planner/lib/emailLinkClient.js"]);
    expect(client).toContain("token_hash: token");
  });
  it("the Supabase mailer is no longer reachable from the app: no resetPasswordForEmail, no signInWithOtp", () => {
    for (const f of walk("src")) { const t = read(f); expect(t, f).not.toMatch(/resetPasswordForEmail|signInWithOtp/); }
  });
});

describe("the set-new-password form cannot be dismissed", () => {
  it("recovery mode renders a LOCKED Wrap, and a locked Wrap ignores Escape, the backdrop and has no Close button", () => {
    expect(panel).toMatch(/title="Set a new password" locked>/);
    expect(panel).toMatch(/onCloseRef\.current = locked \? null : onClose;/);
    expect(panel).toMatch(/onClick=\{locked \? undefined : onClose\}/);
    expect(panel).toMatch(/\{!locked && <button onClick=\{onClose\} aria-label="Close"/);
  });
  it("the pending flag is set on PASSWORD_RECOVERY and on the landing's own success, cleared on success and on sign-out", () => {
    expect(shell).toMatch(/PASSWORD_RECOVERY"\) \{ markRecoveryPending\(\)/);
    expect(shell).toMatch(/isRecoveryPending\(\)\) \{ setRecovery\(true\); setAuthOpen\(true\)/);
    expect(landing).toContain("markRecoveryPending()");
    expect(landing).toMatch(/onRecovery\(\)/);                       // does not depend on the library's event alone
    expect(panel).toMatch(/clearRecoveryPending\(\); setMsg\(\{ type: "ok", text: "Password updated\./);
    const auth = read("src/workspaces/site-planner/lib/auth.js");
    expect(auth.match(/clearRecoveryPending\(\)/g).length).toBeGreaterThanOrEqual(2); // signOut + signOutEverywhere
  });
});

describe("forgot password and the sign-in link do not depend on Cloudflare", () => {
  it("reset mode mounts no Turnstile and the request carries no captcha token", () => {
    expect(panel).toMatch(/mode !== "recovery" && mode !== "reset"/);
    expect(client).not.toMatch(/captcha/i);
  });
  it("the sign-in link button is rendered in the sign-in form regardless of captcha state, and promoted when blocked", () => {
    expect(panel).toMatch(/\{mode === "signin" && \(\s*<>[\s\S]*data-testid="email-link-signin"/);
    expect(panel).toMatch(/captchaBlocked = captchaOn && mode === "signin" && \(cv\.widget === "error" \|\| !!cv\.failure\)/);
    expect(panel).toMatch(/btn\(captchaBlocked\)/);
    expect(panel).toMatch(/btn\(!captchaBlocked\)/);
  });
  it("a failed request shows failureCopy, and 'sent' is shown only from an ok result", () => {
    expect(panel).toMatch(/if \(r\.ok\) \{[^}]*setSent\(/);
    expect(panel).toMatch(/else setMsg\(\{ type: "err", text: failureCopy\(r\) \}\)/);
  });
});

describe("the route's reasoning is written down where the next editor will read it", () => {
  it("the header states why Turnstile may be skipped, and that caps fail closed", () => {
    expect(route).toMatch(/WHY IT MAY SKIP TURNSTILE/);
    expect(route).toMatch(/only ever mails the link to the inbox that already belongs to/);
    expect(route).toMatch(/THE CAPS FAIL CLOSED/);
    expect(route).toMatch(/generate_link[\s*]+is never called for an unknown address/);
  });
  it("it never calls anything that could create an account", () => {
    expect(route).not.toMatch(/\/signup|admin\/users|\/invite|\/otp/);
    expect(route.match(/generate_link/g).length).toBeGreaterThan(0);
    // generate_link sits AFTER the 'no account' early return
    expect(route.indexOf("claim.user_id")).toBeLessThan(route.indexOf("/auth/v1/admin/generate_link"));
  });
});

describe("the migration is service-only", () => {
  const sql = read("src/shared/auth/db/auth_email_link_caps.sql");
  it("RLS on, zero policies, EXECUTE only to service_role, never to a client role", () => {
    expect(sql).toMatch(/alter table public\.auth_email_link_log\s+enable row level security/);
    expect(sql).toMatch(/alter table public\.auth_email_link_config enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/revoke all on function public\.claim_auth_email_link\(text, text, text, text\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.claim_auth_email_link\(text, text, text, text\) to service_role/);
    expect(sql).not.toMatch(/grant [^;]*to (anon|authenticated|public)/i);
  });
  it("fails CLOSED when its config is missing, and stores no address or IP", () => {
    expect(sql).toMatch(/if not found then raise exception 'auth_email_link_config missing'/);
    expect(sql).not.toMatch(/\bemail\s+text|ip\s+(inet|text)\b/);
  });
});
