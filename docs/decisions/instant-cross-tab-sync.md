# Instant cross-tab sync — decision (NEW-1 → B2063056, follow-up B2063057)

**Decision.** Keep focus-refresh + the 45 s tick as the fallback; add **no new transport**. Same-browser tabs
are already instant (verified, now guarded by `e2e/cross-tab-live.spec.js`). The one gap that was cheap to
close — an open plan not adopting another tab's *header* settings — is closed on the existing storage-event
path, using the existing per-leaf merge. **Cross-device realtime for the plan header is NOT built** (needs a
production DB change; see Option B).

## What already existed (measured before building anything)
| Change in tab A | Same browser, tab B | Another device |
|---|---|---|
| Rename project / plan | instant (`storage` event → `onProjectsChanged` → `useProjectName`/`usePlanName`) | next focus / 45 s pull |
| Draw / edit building (element rows) | instant — logged out via the `storage` fold in `SitePlanner`; signed in via the `site_elements` realtime channel (B672) | instant (same channel) |
| Header: settings / origin / layer overrides | **was NOT adopted by an open plan** (only on its next save's merge) → now instant | next focus / 45 s pull (B1953797) |
| Header: status, dates, county, overlay placement | last-write-wins on a save (left as-is, see below) | next focus / 45 s pull |
| Schedule edit | other devices/tabs poll every 20 s + on focus (`checkRemote`, `public/sequence/index.html`) | same |

Probe result on untouched `main`: a two-page, one-context Playwright test for rename + building passed
**without any change** — the owner's real case (two tabs, one browser) was already instant.

## Options and cost
- **A. Same-browser (storage events / BroadcastChannel).** Cost: zero server, zero connections, zero quota,
  no battery. `localStorage` writes already raise a native `storage` event in every *other* tab, and the app
  already listens. A separate BroadcastChannel would be a second path for the same signal (and presence already
  owns the one channel, `planyr-presence-v1`) — rejected as duplicate machinery. **Built: header adoption on this path.**
- **B. Supabase Realtime `postgres_changes` on `sites` / `schedules` / `doc_reviews` / notes.** The app already
  holds **one realtime channel per open plan** (`site-elements:<id>`, plus presence); a table filter on the same
  channel adds **0 connections**. Cost is messages: one per write per other subscribed tab/device, each carrying
  the whole row (header JSON + `thumbnail_svg`, plausibly tens of KB — estimated, not measured; a signed-in
  measurement is not possible from this sandbox). Supabase Free limits (verify in the dashboard before relying on
  them): ~200 concurrent connections, ~2 M messages/month, 100 msg/s. A single user with a few tabs is far under;
  the risk is the multiplier when teams share plans. **Blockers:** `public.sites` is **not** in the
  `supabase_realtime` publication (checked read-only on production: only `planar_suggestions`, `site_elements`),
  so this needs a production migration (`alter publication supabase_realtime add table public.sites`) — an
  outward-facing change I did not make without an owner go-ahead — plus a signed-in two-device live check.
  Failure modes to design for: payload size, a dropped connection (must refetch on re-join, as the elements
  channel already does), echo of own writes (CAS version token already identifies them). → **B2063057, Open.**
- **C. Keep focus-refresh (60 s-throttled on focus + 45 s visible tick).** Zero cost; up-to-45 s stale across
  devices. Remains the fallback under A and B.

## What was built
`SitePlanner.jsx`'s same-browser `storage` handler now merges the other tab's header (settings, origin,
layer overrides/above; device-local `snap` excluded) **per leaf against this tab's merge base** with the existing
`mergeHeader`, then applies only the adopted leaves through the existing `applyAdoptedHeader`. A leaf this tab
is editing (differs from its base) is kept, never overwritten; gestures (`busyRef`) defer it. It runs for signed-in
tabs too (header only — the element union stays gated off when cloud-active, ROWS-CANONICAL). Own writes are
no-ops (header already equal). No new listener, store, or quota use.

## Known limitation (documented, not built)
Header keys *outside* settings/origin/layers — name, status, dates, county, overlay placement — remain
last-write-wins on a save; names are already live across same-browser tabs through the names store. Per-field
merging those would fight `nameAuthority` and needs per-key bases; not cheap, not attempted (B1953797 leaf 1).
