# Key decision: No cross-customer

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **No cross-customer admin view — amended 2026-08-30 (owner go-ahead), superseded by B711904 /
  B877442.** The original absolute form of this line ("no admin view, do not add one") stopped being
  true in practice once B711904 shipped Michael's own internal operator page and B877442 added a
  section to it — the docs were catching up to reality, not granting new permission. What actually
  holds: an **owner-only internal admin surface** exists at `#/admin` (`src/workspaces/admin/`),
  allowlisted to a single account (Michael's) through `admin_users` + the `is_admin()` SECURITY
  DEFINER RPC — see that workspace's `CLAUDE.md`. It may read **operational** data about how the
  product is running (telemetry / error rows from `client_errors`, feature-request queues like
  B877442's county criteria requests) — never a per-customer support-agent view. It still may **NOT**
  become a cross-customer view of other users' **plans, projects, or files**, and `admin_users` still
  **never** gets a SELECT policy — the zero-policy RLS design (client can't read/write the allowlist
  directly; `is_admin()` is the only door) stays load-bearing. The customer-trust reasoning behind the
  original line is unchanged; only its absoluteness was wrong.
