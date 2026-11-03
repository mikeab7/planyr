/* The sign-in alarm's EMAIL — copy + markup (NEW-1, 2026-11-02, after B2619760). SERVER-ONLY, on purpose: it carries the owner's
 * address and inline email styling, and nothing in src/ (which ships to browsers) may. The owner's address is public in exactly
 * two named places (CLAUDE.md → Owner product constraints #34); this is a third, server-side one that is NEVER sent to a browser,
 * named in test/publicContactAddresses.test.js. SIGNIN_ALARM_TO (Cloudflare env) overrides the recipient.
 * Plain English, no jargon without its meaning (the owner is a developer of buildings, not software). */
import { CHECK_LABELS } from "../../../src/shared/auth/signinHealth.js";

export const ALARM_TO = "michael@planyr.io";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const KIND_TITLE = {
  "outside-in": "Sign-in looks broken from the outside",
  "client-rate": "Real browsers are being refused at sign-in",
  blind: "The sign-in check can no longer confirm sign-in",
};

export function buildAlertEmail({ kind, reason, since, checks, events, runUrl, synthetic, mailNote }) {
  const title = KIND_TITLE[kind] || "Sign-in needs a look";
  const subject = `${synthetic ? "[TEST] " : ""}Planyr alarm: ${title}`;
  const failed = (checks || []).filter((c) => c.status === "fail" || c.status === "unknown");
  const lines = [];
  if (synthetic) lines.push("THIS IS A TEST. Nothing is broken — this is the alarm drill proving an email reaches you.", "");
  lines.push(title + ".", "", reason || "", "");
  if (since) lines.push(`First flagged: ${since}`, "");
  if (failed.length) {
    lines.push("What the check saw:");
    for (const c of failed) lines.push(`  • ${CHECK_LABELS[c.name] || c.name} — ${c.status === "fail" ? "FAILED" : "could not be confirmed"}${c.detail ? `: ${c.detail}` : ""}`);
    lines.push("");
  }
  if (events) lines.push(`From people's browsers in the last hour: ${events.ok || 0} signed in, ${events.wrongPassword || 0} typed a wrong password, ${events.refused || 0} were refused by the bot check, ${events.blocked || 0} had the check blocked, ${events.network || 0} hit a network failure.`, "");
  lines.push("You will get exactly one email for this problem, and one more note when it clears.");
  if (runUrl) lines.push("", `Details of the check run: ${runUrl}`);
  if (mailNote) lines.push("", mailNote);
  const text = lines.join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:24px">${esc(text).replace(/\n/g, "<br>")}</div></body></html>`;
  return { subject, text, html };
}

export function buildRecoveryEmail({ kind, openedAt, synthetic, runUrl }) {
  const title = KIND_TITLE[kind] || "Sign-in";
  const subject = `${synthetic ? "[TEST] " : ""}Planyr alarm cleared: ${title}`;
  const text = [
    synthetic ? "THIS IS A TEST. This is the all-clear half of the alarm drill." : "The problem is over.",
    "",
    `${title} — cleared.${openedAt ? ` It was first flagged ${openedAt}.` : ""}`,
    "The outside check passed again.",
    runUrl ? `\nDetails: ${runUrl}` : "",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:24px">${esc(text).replace(/\n/g, "<br>")}</div></body></html>`;
  return { subject, text, html };
}
