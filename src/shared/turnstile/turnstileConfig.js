/* Cloudflare Turnstile config (B1160720, NEW-1) — one place that decides whether the
 * sign-up form should render a CAPTCHA widget at all.
 *
 * The SITE key is public by design (it identifies which widget to render — Cloudflare's
 * own docs call it safe to ship in a browser bundle, the same status as the Supabase anon
 * key). The SECRET key never appears anywhere in this repo: it is pasted once into the
 * Supabase dashboard (Authentication → Sign In / Providers → Bot and Abuse Protection),
 * where Supabase Auth (GoTrue) uses it server-side to verify a token against Cloudflare's
 * siteverify endpoint. Nothing here can bypass that — this module only decides whether to
 * SHOW the widget; the server decides whether to TRUST a signup that skipped it.
 *
 * Absent key ⇒ turnstileEnabled() is false ⇒ AuthPanel renders the plain form, no widget,
 * no captchaToken sent — so local dev and the seeded e2e account (which has no Cloudflare
 * site set up) are never blocked by this feature. */

export const TURNSTILE_SITE_KEY = ((import.meta.env && import.meta.env.VITE_TURNSTILE_SITE_KEY) || "").trim();

export function turnstileEnabled() {
  return !!TURNSTILE_SITE_KEY;
}
