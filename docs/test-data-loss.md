# Data-loss fix — verification harness

Verifies the new-site persistence fix (commit `1699dbc`): a brand-new site is
written to `localStorage` on its **first edit** (not after an edit-volume
threshold), the **Saved** badge reflects the real write, and an edit made just
before closing is flushed.

The build environment can't exercise browser `localStorage` + the React
lifecycle, so this runs **in the browser on the deployed app**. It reads ground
truth from `localStorage` (not the UI) and prints PASS/FAIL.

**App:** https://mikeab7.github.io/planyr/

## How to run
1. Open the app, open DevTools → **Console**, paste the whole harness below.
2. Run the steps in order, doing the small UI actions when prompted.
   `PF.help()` lists them.

```js
// ===== Planyr data-loss verification harness =====
window.PF = (() => {
  const SITES = 'planarfit:sites:v1', CUR = 'planarfit:currentSite:v1', PROBE = 'pfProbe';
  const sites   = () => { try { return JSON.parse(localStorage[SITES] || '{}'); } catch { return {}; } };
  const ptr     = () => localStorage[CUR] || null;
  const rec     = () => sites()[ptr()] || null;
  const resolves= () => !!rec();
  const count   = () => Object.keys(sites()).length;
  const els     = () => (rec() && rec().els ? rec().els.length : null);
  const state   = () => ({ ptr: ptr(), resolves: resolves(), count: count(), els: els() });
  const log = (ok, msg) => console.log(
    `%c${ok ? 'PASS' : 'FAIL'}%c ${msg}`,
    `color:#fff;background:${ok ? '#15803d' : '#b91c1c'};padding:1px 7px;border-radius:4px;font-weight:700`,
    '', state());
  let base = 0;

  return {
    state, sites, ptr, resolves, count, els,
    help() {
      console.log('%cData-loss harness — run in order:', 'font-weight:700;font-size:13px');
      console.table([
        ['1. PF.baseline()',        'records the starting site count'],
        ['2. (UI) New blank site',  'click "Skip — blank canvas" or "+ New blank site"'],
        ['3. PF.checkNew()',        'expect: not yet persisted, badge = "Unsaved"'],
        ['4. (UI) draw ONE building, wait ~1s', 'one element only'],
        ['5. PF.checkPersisted()',  'expect: +1 record, els>=1, resolves true, badge "Saved ✓"'],
        ['6. PF.markReload()',      'snapshots expected state, then reload the page (Ctrl/Cmd+R)'],
        ['7. PF.afterReload()',     'run AFTER reload: expect editor reopened, els match, resolves true'],
        ['—  Case B (close race) —', ''],
        ['8. (UI) new site, draw 1 building, then PF.markReload() + reload IMMEDIATELY (<1s)', 'tests beforeunload flush'],
        ['9. PF.afterReload()',     'expect: building survived'],
      ]);
    },
    baseline() { base = count(); console.log('baseline site count =', base, state()); },

    // Case A step 3 — just created a new blank site, before drawing
    checkNew() {
      log(resolves() === false, 'new blank site is NOT yet persisted (expected) — pointer dangling until first edit');
      console.log('→ visually confirm the save badge reads "Unsaved" (amber), NOT "Saved ✓".');
    },

    // Case A step 5 — after drawing exactly one building + ~1s
    checkPersisted() {
      const ok = resolves() && (els() >= 1) && count() === base + 1;
      log(ok, '1-element new site WAS written to localStorage (count +1, els>=1, pointer resolves)');
      if (!ok) console.warn('If this FAILED: wait 1s and re-run; if still failing the write did not happen.');
      console.log('→ visually confirm the badge now reads "Saved ✓".');
    },

    // step 6 / 8 — snapshot expectation, then reload the page yourself
    markReload() {
      sessionStorage[PROBE] = JSON.stringify({ id: ptr(), els: els(), count: count() });
      console.log('%csnapshot saved — now reload the page, then run PF.afterReload()', 'font-weight:700');
    },

    // step 7 / 9 — run after the reload
    afterReload() {
      let p; try { p = JSON.parse(sessionStorage[PROBE]); } catch { p = null; }
      if (!p) { console.warn('No snapshot — run PF.markReload() before reloading.'); return; }
      const survived = !!sites()[p.id] && (sites()[p.id].els ? sites()[p.id].els.length : 0) >= (p.els || 1);
      const resolvedNow = ptr() === p.id && !!sites()[p.id];
      log(survived, `site ${p.id} SURVIVED reload (els ${sites()[p.id] && sites()[p.id].els ? sites()[p.id].els.length : 'gone'} vs expected ${p.els})`);
      log(resolvedNow, 'currentSite pointer resolves after reload (app should reopen in the editor, not the finder)');
      delete sessionStorage[PROBE];
    },
  };
})();
PF.help();
```

## Expected results (all PASS)
- **checkNew** → `PASS` (dangling until first edit) + badge **"Unsaved"**.
- **checkPersisted** → `PASS` (`count` +1, `els ≥ 1`, `resolves true`) + badge **"Saved ✓"**.
- **afterReload (Case A)** → both `PASS`; app reopens **in the editor** with the building.
- **afterReload (Case B, reload <1s after drawing)** → `PASS`; the `beforeunload` flush saved it.

## Regression checks (do once)
- Open an **existing** site from the finder: badge **"Saved ✓"** immediately, `PF.resolves()` → true; an edit shows **"Saving…"** then **"Saved ✓"**; reload reopens it intact.
- Open a blank site and **leave without drawing**: it is dropped (not persisted) and the pointer cleared → finder on reload. (Intended.)

## What this does / doesn't cover
- **Covers** the real fix end-to-end in the real environment: first-edit persistence, honest badge, reload survival, close-race flush — all read from `localStorage`, not the UI.
- **Doesn't** unit-test the React autosave effect in isolation (no test runner is set up in this repo). The harness is the authoritative check for this bug.
