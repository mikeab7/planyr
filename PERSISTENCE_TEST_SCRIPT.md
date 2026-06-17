# Persistence & Data-Safety — Live Verification Script (B124 / B125 / B126)

A full, runnable browser test for the data-loss fixes. **Run this on planyr.io in a real
browser.** It is the detailed companion to `VERIFICATION.md` item **V15** — when you
finish, record the outcome there (flip ⏳→✅ / ❌) and in the results table at the bottom.

> **Who runs this:** the Claude cohort (a browser-capable session via `/verify` or `/run`).
> Per the testing policy in `VERIFICATION.md`, **Michael does not run this himself.** Only
> interrupt him for a CRITICAL failure (a building actually disappears, the app won't render).

## What we're verifying (plain version)
Work was disappearing because the app saved each site as one lump and, when two copies
existed, kept whichever was **saved last** — wholesale, with no merging. A copy with fewer
buildings could silently overwrite a fuller one. The fix makes the app **merge** two copies
(keep every building in either) and keep **automatic local backups** you can restore from.
This script proves both, plus the earlier fixes that work must survive reload, tab-refocus,
offline edits, and sign-in/out.

---

## Setup (do this once)

1. **Use a throwaway test account**, not production data — several tests create/delete/merge
   sites and one test intentionally drops buildings. Sign in on planyr.io.
2. Open the **Site Planner** workspace.
3. Have **DevTools** ready (F12). Two helpers below.

### Helper A — read-only state inspector (paste in the Console anytime)
Reports the real **building** count (footprints only — it ignores bump-outs / dock dog-ears,
which are internally also "building" elements) for every stored copy, plus the version-history
backups. Read-only; changes nothing.

```js
(() => {
  const main = (els) => (Array.isArray(els) ? els : []).filter(e => e && e.type === 'building' && !e.attachedTo && !e.dogEar).length;
  const when = (t) => t ? new Date(t).toLocaleString() : '—';
  const out = ['OPEN NOW: ' + (localStorage.getItem('planarfit:currentSite:v1') || '(none)')];
  for (const k of Object.keys(localStorage).filter(k => k.startsWith('planarfit:sites:') && !k.includes(':history:'))) {
    let o = {}; try { o = JSON.parse(localStorage.getItem(k)) || {}; } catch (_) {}
    out.push('\nSTORE ' + k);
    for (const s of Object.values(o)) if (s && s.id)
      out.push('  [' + s.id + '] "' + (s.site || '?') + ' / ' + (s.name || '?') + '"  buildings=' + main(s.els) + '  els=' + ((s.els || []).length) + '  saved=' + when(s.updatedAt));
  }
  let h = {}; try { h = JSON.parse(localStorage.getItem('planarfit:sites:history:v1')) || {}; } catch (_) {}
  out.push('\nVERSION HISTORY (automatic backups):');
  for (const [id, list] of Object.entries(h)) { out.push('  ' + id + ': ' + (list || []).length + ' snapshot(s)'); (list || []).forEach(v => out.push('     - ' + when(v.at) + '  buildings=' + v.buildings)); }
  console.log(out.join('\n'));
})();
```

### Helper B — count buildings visible on screen
Zoom-to-fit ("Fit all" / ⤢) first so nothing is off-screen, then count the building shapes by
eye. The on-screen count should match Helper A's `buildings=` for the open site.

> **Pass/fail rule of thumb:** a test PASSES if no building is ever *lost* (count never drops on
> its own). A building *reappearing* after a cross-copy delete is EXPECTED (see T9) — not a failure.

---

## Tests

### T1 — Basic durability across reload
- **Setup:** New site `T1`, draw **3 buildings**, wait for the header badge to read **"Synced ✓"**.
- **Steps:** Reload the page.
- **Expect:** You resume **straight into the planner** on `T1` (not bounced to the map); all **3
  buildings** are there. Helper A shows `buildings=3`.
- **Fail = CRITICAL** (saved work lost on reload).

### T2 — Tab-refocus durability (the "disappears on its own" trigger, B124)
- **Setup:** Site `T1` open with its 3 buildings, badge "Synced ✓".
- **Steps:** Switch to a different browser tab for **~2–3 minutes**, then return to the Planyr tab.
- **Expect:** Site + 3 buildings **still there**; **not** bounced to the map. (This is the exact
  background re-sign-in trigger that used to wipe work.)
- **Fail = CRITICAL.**

### T3 — Offline edit + reload + loud failure banner (B125)
- **Setup:** Signed in, a site open. DevTools → **Network → Offline**.
- **Steps:** Add a building. Then **reload while still offline**. Then go back **Online**.
- **Expect:** While offline, a **loud red banner** ("your last change didn't reach the cloud …
  **Retry now**") appears and the badge reads Offline/Unsaved — **not** a silent success. After the
  offline reload the building is **still present**. Back online → it syncs (badge "Synced ✓") and the
  banner clears.
- **Fail:** silent failure (no banner) = HIGH; lost building = CRITICAL.

### T4 — On-device → account import bridge (B125)
- **Setup:** **Sign out.** Create a site `T4-device` (saved on this device only), draw 1 building.
- **Steps:** **Sign in.**
- **Expect:** A blue banner: *"You have N site(s) saved on **this device** that aren't in your
  account yet."* Click **"Bring them into my account"** → `T4-device` joins the account list. The
  signed-out copy is **kept** (non-destructive — confirm it still exists when signed out again).
- **Fail:** banner missing, or import deletes the original = HIGH.

### T5 — ★ CONTENT MERGE: two tabs, divergent edits, nothing lost (B126 headline)
- **Setup:** Signed in. New site `T5-merge`, draw **2 buildings**, wait "Synced ✓".
- **Steps:**
  1. Open the **same site in a second tab** (same browser is fine). Both tabs now show 2 buildings.
  2. In **Tab 1**: add building **#3**. Wait "Synced ✓".
  3. In **Tab 2** (do **NOT** reload it first — keep it on the stale 2-building view): add a *different*
     building **#4** in another spot. Wait "Synced ✓".
  4. **Reload BOTH tabs.**
- **Expect:** **Both tabs show all 4 buildings.** Helper A shows `buildings=4`. Neither tab's save
  erased the other tab's new building.
- **Before the fix this failed:** whichever tab saved last won wholesale → you'd see only 3 (one
  tab's new building gone). **If you see 3, that is the bug — flag CRITICAL.**

### T6 — ★ A thinner copy saved LAST cannot erase a fuller one (B126)
- **Setup:** New site `T6`, draw **5 buildings**, "Synced ✓". Open it in **two tabs** (both show 5).
- **Steps:**
  1. In **Tab 2**: move/nudge one building slightly (a harmless edit) and let it save — but **don't add
     or delete** anything. Tab 2 still has 5.
  2. In **Tab 1**: also nudge a building so Tab 1 saves **after** Tab 2. (Goal: two copies, both 5,
     saved at slightly different times.)
  3. Reload both.
- **Expect:** Still **5 buildings** in both — the count never dropped. Helper A `buildings=5`.
- **Fail = CRITICAL** if any building vanished.

### T7 — ★ Version history: list, restore, reversible (B126)
- **Setup:** Site `T7`, draw **4 buildings**, "Synced ✓".
- **Steps:**
  1. **Delete 2 buildings** (now 2). Wait "Synced ✓".
  2. Open **Plan ▾ → "Version history…"**.
  3. Find the earlier snapshot showing **4 buildings** and click **Restore**.
  4. After it restores, re-open **Version history**.
- **Expect:** (a) The dialog lists earlier automatic backups with a date + building count. (b) Restore
  brings the canvas back to **4 buildings** (Helper B / Helper A confirm). (c) On re-open, the
  **2-building** state you just replaced is now **also** listed — i.e. a restore is itself reversible.
- **Fail:** dialog empty after edits, Restore doesn't bring the buildings back, or restore isn't
  reversible = HIGH.
- **Note:** a restored **aerial / backdrop image** may show as needing a re-drop — that's expected
  (geometry is always restored; big images are not kept in the backup). Building geometry must be intact.

### T8 — Version-history de-dupe sanity (B126)
- **Setup:** Site `T8` with a couple of buildings.
- **Steps:** (a) Make 3 edits that each **change the count** (add, add, delete), letting each save.
  Then (b) **move** a building without changing the count and let it save. Check Helper A's history list.
- **Expect:** The count-changing edits each appear as their own snapshot; the **pure move does NOT**
  spam a brand-new snapshot. History stays a meaningful, capped list (≤ ~15 per site).
- **Fail:** runaway history (a new entry on every tiny save) = LOW (cosmetic/quota), note it.

### T9 — Delete trade-off is EXPECTED, not a bug (B126)
- **Setup:** New site `T9`, draw 3 buildings, "Synced ✓". Open in **two tabs** (both show 3).
- **Steps:** In **Tab 1** delete building **#3** (now 2), wait "Synced ✓". In **Tab 2** (stale, still
  shows 3) make a small edit so it saves its 3-building copy. Reload both.
- **Expect:** Building #3 **may reappear** (both tabs show 3). **This is the documented, accepted
  trade-off** — the app keeps a building present in *either* copy. Deleting it again now (with no other
  stale copy open) makes it stay gone.
- **This is a PASS** as long as: nothing was *lost*, and a fresh delete sticks. **Do NOT file a bug**
  for the reappearance — it's the deliberate "never silently lose work" trade-off (per B126).

### T10 — Normal single-session delete still works (regression guard)
- **Setup:** One tab only. Site `T10`, draw 4 buildings, "Synced ✓".
- **Steps:** Delete 1 building (now 3). Wait "Synced ✓". Reload.
- **Expect:** **3 buildings** after reload — a normal delete in a single editing session sticks (the
  merge must not resurrect it when there's no competing copy). Helper A `buildings=3`.
- **Fail:** the deleted building comes back with no other copy in play = HIGH (over-eager union).

### T11 — Cross-device union (OPTIONAL — needs two devices)
- **Setup:** Same account signed in on two devices (e.g. laptop + phone). Open the same site on both.
- **Steps:** On device A add building **X**; on device B add building **Y**; let both sync; refresh both.
- **Expect:** Both devices show **X and Y** — cross-device work unions, nothing lost.
- **Fail = CRITICAL** if a device's building is lost.

---

## Results — fill in and copy back

| Test | What it proves | Result (✅/❌) | Notes (count seen, console output, console errors) |
|------|----------------|---------------|----------------------------------------------------|
| T1  | Reload durability | ⏳ | |
| T2  | Tab-refocus durability | ⏳ | |
| T3  | Offline + loud banner | ⏳ | |
| T4  | On-device → account import | ⏳ | |
| T5  | ★ Two-tab merge keeps both | ⏳ | |
| T6  | ★ Thinner-saved-last can't erase fuller | ⏳ | |
| T7  | ★ Version history restore (reversible) | ⏳ | |
| T8  | History de-dupe | ⏳ | |
| T9  | Delete trade-off is expected | ⏳ | |
| T10 | Single-session delete sticks | ⏳ | |
| T11 | Cross-device union (optional) | ⏳ | |

**When done:** update `VERIFICATION.md` **V15** (⏳→✅ / ❌ with the date), and flag any **CRITICAL**
result to Michael immediately (the exact test + the browser console). Everything else: record here and
move on.
