# Verification inbox — 2026-08-30 — B877440 / B877441 / B877442 (V490272 / V490273 / V490274)

**Why this file exists.** `Blocker: auth` / `real-data` / `live-GIS` items in `VERIFICATION.md` can only be
closed by the Cowork thread driving Michael's signed-in browser — and that actor cannot push to this repo.
Sessions can push but cannot sign in. This directory is the missing pipe (B825232). Append-only. A session
drains it into `VERIFICATION.md`, moves fully passed items to `VERIFICATION-DONE.md`, and marks the entry
drained here with the PR number.

Run on Michael's real signed-in browser against production `planyr.io`, right after `8201788` (PR #1240)
deployed. **None of the three items below is a full pass — each has named steps that were NOT driven this
pass, and each stays open in `VERIFICATION.md` with exactly those steps still pending.**

---

## V490272 — B877440 `Blocker: live-GIS` — PARTIAL PASS: steps 1, 2, 5 driven live; steps 3, 4 NOT driven

**Step 1 — a plan locates in a real, unmodeled county.** PASS. Real Tarrant County parcel, 4909 NE LOOP 820,
Haltom City, 15.38 AC, located live through the real GIS identify. Header read "City of Haltom City /
Tarrant County."

**Step 2 — the Detention verdict row reads the named no-data state.** PASS. After the drainage check, the
Yield verdict strip read VERBATIM: "Detention: no detention criteria on file for Tarrant County" with a
"Request criteria for Tarrant County" action beside it — no number, and not the B1127 permanent spinner.

**Step 5 — a MODELED county is completely unaffected (the non-negotiable control).** PASS. Separate
throwaway on a real Harris County parcel (City of Houston ETJ, 7.44 AC): "Detention: 0.0 of 7.4 AC-FT" — a
real priced volume, and no request button. Both directions proven on one build.

**Steps 3 and 4 — NOT driven, stay pending.** The Easement-rules disclosure check (expected "No easement
criteria on file for Tarrant County" instead of a 20 ft width, with the jurisdiction `<select>` still
working) and the "Route water service" refusal check were not reached in this session.

**Additional corroboration of step 5, independently measured.** A full probe of every modeled jurisdiction
was run head-to-head from clean worktrees of `origin/main`-before and the PR branch, and every answer is
byte-identical across the change: hcfcd band `[11.535, 15.38]`; fortbend `13.2268` at `0.86`; montgomery
`10.423` at `0.6777`; chambers band `[7.69, 18.456]`; waller band `[8.459, 9.997]`; coh `8.6128` at `0.8`;
the Colorado guard still reads kind `"unavailable"`. A diff of the full probe output across the two trees
shows exactly ONE difference in the whole run — the new `unmodeledCounty` field — which is the feature
itself, not a side effect. Michael's own two throwaway plans used for this pass were deleted afterwards
(site count read 28 before and 28 after); his Richfield plan was never written to. The one deliberate
residue is the real Tarrant/Detention row now sitting in `criteria_requests` — that row is the demo data
now visible in his admin page (V490274, step 2).

---

## V490273 — B877441 `Blocker: auth` — PARTIAL PASS: steps 1, 2 driven live; steps 3, 4, 5 NOT driven

**Step 1 — filing actually files.** PASS, on Michael's real signed-in account against the real production
`criteria_requests` table. Clicking "Request criteria for Tarrant County" filed and the row read back
"Requested ✓ 8/30/2026".

**Step 2 — the filed state survives a reload.** PASS. A full page reload still read "Requested ✓
8/30/2026," with no automatic re-send.

**Steps 3, 4 and 5 — NOT driven, stay pending.** The cleared-site-data server-side dedupe check, the
separate easement-family request, and the offline LOUD-FAILURE path were not driven this pass.

---

## V490274 — B877442 `Blocker: auth` — PARTIAL PASS: steps 1, 2 driven live; steps 3, 4, 5 NOT driven

**Step 1 — the admin page loads with the new section.** PASS. `#/admin` loaded on Michael's real admin
account and rendered the fifth section below the four existing placeholders (Usage, Issues, Support, Ops).

**Step 2 — the table lists the filed request with the correct status.** PASS. Read VERBATIM: "County
criteria requests — Counties with no detention / easement / pond / floodplain criteria on file, filed from
the plan's Request criteria action. 1 outstanding of 1." One row: "Tarrant County | TX | Detention | 1 |
8/30/2026 | 8/30/2026 | Outstanding." The whole chain — no-data state → button → filed row → admin queue →
correct Outstanding status — works end to end on real production data.

**Steps 3, 4 and 5 — NOT driven, stay pending.** The second-device dedupe check, the non-admin-account gate
check, and the later Wired-checkmark flip (once a county is wired in a future session) were not driven this
pass.

---

> **Drained → `VERIFICATION.md` by PR #(pending — filled in before merge) (2026-08-30).** All three items updated in place with the
> partial-pass evidence above; none moved to `VERIFICATION-DONE.md` — each still names its own pending
> steps (V490272: 3, 4 · V490273: 3, 4, 5 · V490274: 3, 4, 5). Draining is a transcription, not a rubber
> stamp: no step is marked passed beyond what was actually driven. No source file changed as part of this
> drain — records only.
