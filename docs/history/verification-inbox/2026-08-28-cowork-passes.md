# Verification inbox — 2026-08-28 — passes closed by the Cowork thread

**Why this file exists.** `Blocker: auth` / `real-data` / `live-GIS` items in `VERIFICATION.md` can only be closed by the Cowork thread driving Michael's signed-in browser — and that actor cannot push to this repo. Sessions can push but cannot sign in. The result was a lifecycle with no exit: an audit on 2026-08-28 found **211 pending items, 130 of them carrying no `Blocker:` at all, 125 between 31 and 60 days old, and V220 sitting for 436 days.**

This directory is the missing pipe. Append-only. A session drains it into `VERIFICATION.md`, moves fully passed items to `VERIFICATION-DONE.md`, and marks the entry drained here with the PR number.

---

## V437024 — B784832 `Blocker: auth` — PASS, one leg noted

Closed 2026-08-26 on Michael's signed-in Chrome, on a real cloud plan.

- Created a callout, deleted it, pressed Ctrl+Z. It returned on canvas.
- The **server row genuinely un-deleted**, read back from production `site_elements`: `rev 4`, `op_kind: "edit"`, `deleted_at: null`.
- **Leg NOT separately performed:** "and it survives a reload." Durable server state was confirmed, which is the mechanism a reload would exercise, but the reload click itself was not done. Accept that reasoning explicitly on the record, or leave that leg open. Do not silently mark the item done without saying which.

> **Drained → `VERIFICATION-DONE.md` by PR #1207 (2026-08-28).** Decision on the noted leg: **accepted** — the server-side row check (rev 4, `deleted_at: null`, read directly from production `site_elements`) is direct proof of durable persistence, which is exactly the state a reload would display; the separate reload click is judged redundant given the stronger check. Marked ✅ PASSED, not left open. See the full reasoning on the archived entry.

## V326656 — B648353 `Blocker: auth` — PASS

Closed 2026-08-26 on Michael's signed-in Chrome. This is precisely the leg the existing entry could not reach: the headless run was logged-out against local canvas state, and the auth/cloud-sync half was open.

- Three real deletions on a signed-in plan; opened the Undo caret; hovered the third row.
- Footer read **UNDO 3 ACTIONS**; one click restored all three.
- **Server confirmed:** the parcel row and the el rows came back un-deleted in production.

> **Drained → `VERIFICATION-DONE.md` by PR #1207 (2026-08-28).** Marked ✅ PASSED.

## V453152 — B802400 round 5 `Blocker: live-GIS` — PASS, with a stated residual

Closed 2026-08-27/28 from Michael's own in-app perf captures — stronger than a synthetic pass, because it is his real plan, his hardware, and the live 3DEP service. Source: production `client_errors`, `source='event:perfcap'`, plan `smt7q6ar8egz`, `layers:"contours"`, `baselineMs` 16.7 throughout.

| | before (Aug 26) | after, build `6d95614` |
|---|---|---|
| worst single long task | **3,099 ms** | **193 ms** |
| mean frame time in window | 227–332 ms | 38–105 ms |
| ratio to baseline | 13.6–19.9× | 2.3–6.3× |

The multi-second freeze this item was written about is **gone** — a 16× reduction in the worst block, which is the acceptance condition.

**Residual, stated not buried:** still 2.3–6.3× baseline with `slowFraction` 0.5. Jank, not a freeze, and now many small tasks rather than a few enormous ones. PR #1200 was already honest that a few very long seam-joined polylines cannot be sub-divided by op-count chunking. That residual deserves its own item; it does **not** keep V453152 open.

> **Drained → `VERIFICATION-DONE.md` by PR #1207 (2026-08-28).** Marked ✅ PASSED with the residual stated. On "deserves its own item": B802400 round 5's own BACKLOG.md text already names this identical residual and its cause (an atomic, non-subdividable seam-joined polyline) as a flagged follow-up — per **DEDUPE-FIRST**, no new B# is minted for it; it stays visible where the mechanism already lives, revisited only if the owner reports lag again.

---

## Explicitly NOT closed — recorded so silence is not mistaken for a pass

### V439600 — B794960 `Blocker: live-GIS` — STILL PENDING

The item requires the arrowhead and hatch tiles measured on a **real downloaded PDF/PNG file**. What was actually done: the in-app Compose-exhibit preview (a `blob:` image, 1056×816) was read at 2.5–8× magnification and the arrowhead confirmed visibly proportionate — emphatically not the pre-fix 11.7× oversize. **No PDF was downloaded.** The on-sheet arrowhead/fontPx ratio was never pinned numerically; that preview raster carries roughly ±20% measurement error. Exact on-screen figures were taken from the live SVG (arrowhead height 13.725 user units, callout `font-size` 21.2865 px, ratio 0.645), but the sheet-side half of the comparison does not exist. **This item stays pending.**

### V438336 — B793696 — BLOCKED ON THE OWNER

Needs `github.com/mikeab7/planyr/settings/actions` → Workflow permissions → "Read and write permissions". Until then `pr-auto-ready.yml` cannot un-draft a PR or arm auto-merge. Asked once; not nagging.

> **Resolved outside this inbox path, not still pending.** The owner flipped this setting (confirmed
> 2026-08-31) and it was live re-tested on a fresh real PR — still the identical FORBIDDEN error. He
> then declined a PAT / GitHub App credential a second time, and `.github/workflows/pr-auto-ready.yml`
> is now deleted outright. Closed 2026-08-31 in `VERIFICATION-DONE.md` as a permanent, owner-accepted
> limitation (B793696/B934400–B934402) — not a pending owner ask. Do not re-raise the settings flip
> with the owner; do not re-file this as "blocked on the owner."
