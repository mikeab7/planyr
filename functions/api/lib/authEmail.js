/* The plain, branded email behind POST /api/auth/email-link (NEW-1) — same look as the team-invite email
 * (functions/api/lib/inviteEmail.js): one white card, one button, one short note. Pure; no network.
 * Wording that names the sender / validity lives in ONE place each: the sender in
 * src/workspaces/site-planner/lib/authMail.js (the browser copy) and the hour in shared/auth/authLink.js. */
import { LINK_VALID_MINUTES, SUPPORT_EMAIL } from "../../../src/shared/auth/authLink.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const COPY = {
  reset: {
    subject: "Planyr password reset",
    lead: "Someone asked to reset the password for your Planyr account. Press the button to choose a new one.",
    button: "Reset password",
    ignore: "If that wasn\u2019t you, ignore this email \u2014 your password has not changed.",
  },
  signin: {
    subject: "Your Planyr sign-in link",
    lead: "Press the button to sign in to Planyr. You don\u2019t need your password.",
    button: "Sign in to Planyr",
    ignore: "If you didn\u2019t ask for this, you can ignore this email \u2014 nobody can sign in without it.",
  },
};

export function buildAuthEmail({ kind, link }) {
  const c = COPY[kind];
  if (!c) throw new Error("unknown email kind");
  const valid = `This link works once and expires in ${LINK_VALID_MINUTES === 60 ? "1 hour" : LINK_VALID_MINUTES + " minutes"}.`;
  const help = `Trouble? Reply to this email or write ${SUPPORT_EMAIL}.`;
  const text = `${c.lead}\n\n${c.button}: ${link}\n\n${valid}\n${c.ignore}\n\n${help}\n`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:28px">
<p style="margin:0 0 20px;font-size:16px;line-height:1.5">${esc(c.lead)}</p>
<p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px">${esc(c.button)}</a></p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#374151">${esc(valid)} ${esc(c.ignore)}</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#6b7280">${esc(help)}</p>
</div></body></html>`;
  return { subject: c.subject, html, text };
}
