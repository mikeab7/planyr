# Admin workspace — folder pointer

Michael's own internal operator page (B711904 / NEW-1). NOT a tabbed workspace — no header
tab, no `MODULE_BY_SLUG` entry, never offered by the module switcher. Reached only by typing
`#/admin` directly; the app shell's route helper (`isAdminRoute`, in the root `src/app/`
folder) recognizes the hash and the shell mounts this folder's lazy chunk only then. Gated to
a short allowlist of user ids (starts with Michael's own account only — this is deliberately
not a role system yet); anyone else hitting `#/admin` sees the ordinary app underneath,
indistinguishable from any other unrecognized route — never a permission-denied page.

**Files**
- `AdminGate.jsx` — the ONE place that decides access. Calls the `is_admin()` Postgres RPC
  (only while signed in; never for a signed-out visitor) and renders `AdminApp` only on a
  confirmed `true`. Every other outcome (denied, still checking, RPC error) renders `null`.
- `AdminApp.jsx` — the page shell: a small header + the four section placeholders NEW-2..
  NEW-5 fill in (Usage / Issues / Support / Ops), listed in `lib/adminSections.js`.
- `lib/adminAccess.js` — `checkIsAdmin(client)`, the pure wrapper around the RPC call. Fails
  closed on every path (no client, no session, an RPC error, a thrown exception) — never
  renders the admin page on an ambiguous result.
- `db/admin_users.sql` — the allowlist table + the `is_admin()` SECURITY DEFINER function.
  `admin_users` has RLS enabled with **zero policies** (same discipline as `client_errors`'
  INSERT-only design, B279 — never add a SELECT policy to make a future check easier); the
  RPC is the only door in or out, and reveals nothing but a boolean.

**Depends on this landing:** B711905 (Usage), B711906 (Issues), B711907 (Support), B711908
(Ops) all render inside `AdminApp`'s section shells and call through the same admin-gated
RPC pattern — each mints its own `SECURITY DEFINER` function rather than a client-side SELECT
policy on the table it reads.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
