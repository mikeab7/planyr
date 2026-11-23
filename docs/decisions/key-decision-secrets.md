# Key decision: Secrets

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **Secrets stay in env/secrets, never committed.** Covers Supabase keys, the Autodesk
  APS key, and Google Drive credentials. The Supabase **anon key is RLS-protected and
  safe to ship in the client**; the Supabase **service_role key and all third-party
  API keys must stay server-side only** and never reach the browser.
