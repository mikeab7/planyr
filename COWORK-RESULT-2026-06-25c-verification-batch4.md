# COWORK-RESULT 2026-06-25 (batch 4) — two-tab data-safety lockout + the floor of solo-verifiable items

> **Claude Code: please fold into `VERIFICATION.md`.** Filed as a result-doc (same reason as PR #365/#366 — fast-moving `main`). Signed-in on planyr.io, owner's browser, two real tabs of the same Chrome.

## Confirmed live

- **V136 / V132 ✅ (two-tab single-active-editor read-only lockout — B455/B464/B465/B466).** Opened **8 South** in **two tabs** of the same browser. The **2nd tab went read-only** via Web Locks, showing the exact loud banner: *"👁 Read-only — this plan is open in another tab, which is the active editor. Your changes here are saved on this device but aren't syncing to the cloud yet. Reloading won't help while the other tab is open — take over here, or close the other tab."* + an amber **"Take over editing here"** button. Clicking **Take over** flipped the 2nd tab to active (green *"You're now editing here — pulled in the latest and your changes are saving to the cloud"*) **and handed the first tab DOWN to read-only** (same banner appeared in tab A) — i.e. the yield broadcast over the bus works both directions. This is the core read-only-lockout + take-over of V136, and the single-active-editor lockout of V132 (B455), confirmed end-to-end. (The other two V136 sub-checks — telemetry rows in `public.client_errors`, and the Fort Bend FLOODZONE CORS-proxy — weren't driven; they need DB/telemetry access + a Fort Bend parcel load.)

## Partially advanced

- **V2 ◑ (GIS stale-while-revalidate + data-age).** Observed in V101's Site Analysis on Grand Port: each source carries a **data-age** stamp ("Zone X · 4d ago", pipelines/wells "· just now"), and an unreachable source shows its last-good value with an honest "couldn't refresh" rather than blanking (the SWR behavior). The dedicated B96 cache-age UI wasn't exercised in isolation, but the age display + stale-while-revalidate honesty are present.

## Not drivable with this tooling

- **V11 ⏳ (phone layout).** `resize_window` to phone width (414 px) did **not** produce a real phone viewport — the captured render stays the desktop layout at 1568 px — so the responsive phone layout + "Cloud off" affordance can't be exercised here. Needs real mobile-device emulation or an actual phone.
- **V135 ◑/⏳ (no spurious conflict on benign re-open).** With two tabs on the same project the **read-only lockout always engages**, which subsumes the dual-edit scenario V135 describes; the benign-reopen-no-conflict path couldn't be cleanly isolated from the lockout (and a reload of either tab interacts with the V13 reload-bounce). The boot re-push content-diff logic is unit-tested; a clean live isolation wasn't reachable.

## Floor reached
With the two-tab checks now done, the solo-signed-in-browser verifiable surface of VERIFICATION.md is effectively exhausted. What genuinely remains needs assets/tooling a single browser can't supply: a **2nd user account** (V118 team sharing), a **fresh dropped PDF / real drawings** (V99, V79, V74, V66, V63, V67, V131-B448), a **forced network outage / full localStorage** (V137, V136-telemetry/FortBend, V61, V136-CORS), or **real mobile emulation** (V11). Those are best run from Claude Code's headless/CI harness or a deliberately set-up multi-browser/multi-user session.
