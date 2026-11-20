/* NEW-1 — the pure rules for "Planyr emails you a sign-in / reset link".
 *
 * ONE module read by BOTH sides: the Cloudflare Function that mints and mails the link
 * (functions/api/auth/email-link.js) and the browser page that receives it (app/AuthLinkLanding.jsx),
 * so the link the server writes and the link the page reads cannot drift. No DOM, no network.
 *
 * THE LINK. The email points at a Planyr PAGE — `/?app&authlink=<token_hash>&kind=reset|signin[&next=…][&h=…]`
 * — not at Supabase's /verify. Corporate mail scanners open every link in a message, and Supabase's own
 * links spend the one-time token on that first GET, so the person arrives to "expired". Opening our page
 * spends nothing; only the button press calls verifyOtp with the token hash.
 *
 * THE ADDRESS IS NEVER IN THE LINK. `h` is an 8-hex-character fingerprint of the address (32 bits of
 * SHA-256) so the page can tell "you are already signed in as the account this link is for" from "a
 * different account" BEFORE anything is swapped. It cannot be turned back into an address; many
 * addresses share each value, so a match is "probably the same account" and is double-checked by id after
 * the session is made. The token hash itself is single-use, good for one hour, and useless without the
 * button press.
 *
 * `next` carries the in-app route the person started from, and only a plain hash route survives
 * `safeNextRoute` — never a URL, never a query, never a path out of the app. */

export const LINK_VALID_MINUTES = 60;
export const SUPPORT_EMAIL = "support@planyr.io";
export const AUTH_LINK_PARAMS = ["authlink", "kind", "next", "h"];
export const LINK_KINDS = ["reset", "signin"];

// GoTrue's hashed_token is a hex digest; accept url-safe base64 too so a format change does not strand links.
export const isTokenShape = (t) => typeof t === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(t);

/** "#/library" | "/library" → "/library"; anything that could leave the app or carry markup → null. */
export function safeNextRoute(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.startsWith("#") ? raw.slice(1) : raw;
  if (s.length < 2 || s.length > 80) return null;
  if (!/^\/[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(s)) return null; // no query, no dots, no backslash, no %-escapes, no scheme, no //
  if (s.includes("//")) return null;
  return s;
}

/** 8 hex characters of SHA-256(lowercased, trimmed address); null for an empty address. */
export async function accountHint(email) {
  const e = String(email == null ? "" : email).trim().toLowerCase();
  if (!e) return null;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(e)));
  return Array.from(d.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildAuthLinkUrl({ appUrl, kind, token, email, next }) {
  if (!LINK_KINDS.includes(kind)) throw new Error("unknown link kind");
  if (!isTokenShape(token)) throw new Error("malformed token");
  const base = String(appUrl || "https://planyr.io").replace(/\/+$/, "");
  const q = [["app", null], ["authlink", token], ["kind", kind]];
  const n = safeNextRoute(next);
  if (n) q.push(["next", n]);
  const h = await accountHint(email);
  if (h) q.push(["h", h]);
  return `${base}/?` + q.map(([k, v]) => (v == null ? k : `${k}=${encodeURIComponent(v)}`)).join("&");
}

/** Read the link out of a location.search. Never throws; `present` is whether this is a link visit at all. */
export function parseAuthLinkSearch(search) {
  let q;
  try { q = new URLSearchParams(String(search || "")); } catch (_) { return { present: false }; }
  if (!q.has("authlink")) return { present: false };
  const token = q.get("authlink") || "";
  const kindRaw = q.get("kind");
  const kind = LINK_KINDS.includes(kindRaw) ? kindRaw : null;
  const hintRaw = q.get("h");
  return {
    present: true,
    token,
    kind,
    tokenOk: isTokenShape(token) && !!kind,
    next: safeNextRoute(q.get("next")),
    hint: /^[0-9a-f]{8}$/.test(hintRaw || "") ? hintRaw : null,
  };
}

/** The same search string with only this feature's parameters removed ("?app" stays exactly as written). */
export function stripAuthLinkParams(search) {
  const s = String(search || "").replace(/^\?/, "");
  if (!s) return "";
  const kept = s.split("&").filter((p) => p && !AUTH_LINK_PARAMS.includes(p.split("=")[0]));
  return kept.length ? "?" + kept.join("&") : "";
}

/** What verifyOtp's failure means to the person: expired/used · rate · network · other. */
export function classifyVerifyFailure(err) {
  if (!err) return "other";
  const status = typeof err.status === "number" ? err.status : null;
  const code = String(err.code || err.error_code || "");
  const msg = String(err.message || "");
  const nameStr = String(err.name || "");
  if (status === 429 || code === "over_request_rate_limit" || code === "over_email_send_rate_limit") return "rate";
  if (code === "otp_expired" || /expired|invalid/i.test(msg) && (status === 403 || status === 400 || status === 422 && /link|token/i.test(msg))) return "expired";
  if (status === 0 || nameStr === "AuthRetryableFetchError" || err instanceof TypeError || /failed to fetch|network|load failed/i.test(msg) || (status != null && status >= 500)) return "network";
  return "other";
}

const A = (id, label, extra = {}) => ({ id, label, ...extra });

/* The landing page's whole state table. `phase`: idle | verifying | failed{kind}. Every state returns at
 * least one action — a state with nothing to press is a defect, not a note. */
export function landingPlan({ link, phase, user, userHint }) {
  const support = SUPPORT_EMAIL;
  const kind = link && link.kind;
  const go = kind === "reset" ? "Set a new password" : "Continue to Planyr";
  const newOne = A("resend", "Send me a new link");
  const toSignIn = A("signin", "Back to sign in");
  if (!link || !link.present || !link.tokenOk) {
    return { state: "malformed", title: "This link looks incomplete", message: "Part of the link is missing, which can happen when an email program breaks a long address in two. Ask for a new one and use it straight from the email.", actions: [newOne, toSignIn], support };
  }
  const p = phase || { name: "idle" };
  if (p.name === "verifying") {
    return { state: "verifying", title: kind === "reset" ? "Setting things up…" : "Signing you in…", message: "One moment.", actions: [A("continue", go, { primary: true, disabled: true })], support };
  }
  if (p.name === "failed") {
    const k = p.kind;
    if (k === "expired") return { state: "expired", title: "This link has expired or was already used", message: `Each link works once and for ${LINK_VALID_MINUTES} minutes. Some email programs open a link to check it, which uses it up before you do.`, actions: [newOne, toSignIn], support };
    if (k === "rate") return { state: "rate", title: "Too many tries just now", message: "Wait a minute, then press the button again. Your link is still good.", actions: [A("retry", "Try again", { primary: true }), newOne], support };
    if (k === "network") return { state: "network", title: "Couldn’t reach Planyr", message: "Check your connection, then press the button again. If the link then says it has expired, ask for a new one.", actions: [A("retry", "Try again", { primary: true }), newOne], support };
    return { state: "other", title: "That didn’t work", message: "Something went wrong opening this link. A new link usually fixes it.", actions: [newOne, toSignIn], support };
  }
  if (user) {
    const mine = userHint && link.hint && userHint === link.hint;
    if (mine) {
      return { state: "same-account", title: kind === "reset" ? "Set a new password" : "You’re already signed in", message: `You’re signed in as ${user.email}, which looks like the account this link is for.`, actions: [A("continue", kind === "reset" ? "Set a new password" : "Continue to Planyr", { primary: true })], support };
    }
    return {
      state: "different-account", title: "You’re signed in as someone else",
      message: `This browser is signed in as ${user.email}. This link is for a different account. Switching signs you out of ${user.email} here.`,
      actions: [A("switch", kind === "reset" ? "Switch and set a new password" : "Switch accounts", { primary: true }), A("stay", `Stay signed in as ${user.email}`)], support,
    };
  }
  return { state: "ready", title: kind === "reset" ? "Reset your password" : "Sign in to Planyr", message: kind === "reset" ? "Press the button to choose a new password." : "Press the button to finish signing in.", actions: [A("continue", go, { primary: true }), toSignIn], support };
}
