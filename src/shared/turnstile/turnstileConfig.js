/* Cloudflare Turnstile config (B1160720; widened by NEW-1) — one place that decides whether the
 * logged-out auth forms (Sign in, Sign up, Forgot password — one shared widget) render a CAPTCHA at all.
 *
 * The SITE key is public by design (it identifies which widget to render — Cloudflare's
 * own docs call it safe to ship in a browser bundle, the same status as the Supabase anon
 * key). The SECRET key never appears anywhere in this repo: it is pasted once into the
 * Supabase dashboard (Authentication → Sign In / Providers → Bot and Abuse Protection),
 * where Supabase Auth (GoTrue) uses it server-side to verify a token against Cloudflare's
 * siteverify endpoint. Nothing here can bypass that — this module only decides whether to
 * SHOW the widget; the server decides whether to TRUST a sign-in / sign-up / password-reset that skipped it
 * (all three are captcha-gated server-side — NEW-1 found that a client sending no token for the first
 * and last was refused with "captcha protection: request disallowed").
 *
 * Absent key ⇒ turnstileEnabled() is false ⇒ AuthPanel renders the plain form, no widget,
 * no captchaToken sent — so local dev (no Cloudflare site, no captcha on its Supabase) is never
 * blocked by this feature. (Headless sessions against production sign in through
 * /api/auth/e2e-session instead; the app's own panel now sends a real token.) */

export const TURNSTILE_SITE_KEY = ((import.meta.env && import.meta.env.VITE_TURNSTILE_SITE_KEY) || "").trim();

export function turnstileEnabled() {
  return !!TURNSTILE_SITE_KEY;
}
