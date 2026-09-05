/* visualBaseline — the pure half of visual regression baselines (NEW-1, global/ui-audit).
 *
 * WHY THIS EXISTS. Every design-system check that shipped 2026-08-31/09-01 (docs/DESIGN.md, the
 * drift guard, docs/UI-INVENTORY.md, nestingMismatches()/siblingMismatches()/alignmentMismatches(),
 * the 5-role type scale, locked-geometry primitives) shares one flaw: it only catches a failure
 * mode someone already anticipated and wrote a rule for. Visual regression needs no theory of what
 * "wrong" looks like — it renders a surface, diffs it against a human-approved picture, and asks a
 * person to look at anything that moved. This file is the deterministic, file-system-free half of
 * that check (surface list, tolerance policy, pass/fail verdict, the generated status doc) so it can
 * be unit-tested without a browser. `ui-audit/visual-regression.mjs` is the Playwright half that
 * actually renders the app and calls back into this.
 *
 * ⛔ WHY docs/VISUAL-REGRESSION.md IS BUILT FROM THE MANIFEST, NEVER FROM A LIVE CAPTURE'S DIFF
 * NUMBERS. ui-inventory.mjs's `--check` regenerates docs/UI-INVENTORY.md from a fresh crawl and
 * diffs it against the committed file — safe there because every number it prints (radius/height/
 * font-size counts) is a deterministic function of the CURRENT SOURCE, so a clean run always
 * regenerates byte-identical content. A live PIXEL DIFF is not that: it is a comparison against
 * whatever the committed baseline happens to be, and if this doc embedded live diff percentages,
 * `--check` would rewrite it (to "0.0000% differing") on every single green run and the doc-drift
 * gate would never stay clean two runs in a row. So the generated doc is built from the APPROVAL
 * MANIFEST (surface list + tolerance policy + when each baseline was last approved and at what
 * commit) — content that changes only when a baseline is actually re-approved, exactly when the doc
 * SHOULD change. The live diff (pass/fail against the committed PNGs) is a SEPARATE check in
 * `--check` mode, reported to the console/CI log, never baked into the committed markdown.
 */

export const THEMES = ["light", "dark"];

/* ---------------------------------------------------------------------------------------------
 * Viewports (NEW-2, 2026-09-03). Every surface below was, until now, screenshotted at exactly
 * ONE size — 1440×900 — which is why a narrow-width layout defect (the update banner squeezed
 * to a sliver on the owner's own iPhone, planyr.io, 2026-09-03) shipped with every visual gate
 * green: nothing in this file's history ever rendered anything narrower than 1440px. `phone` is
 * the owner's own device class — 390 CSS px is the convention this repo already uses everywhere
 * else a phone width is asserted (`verify-phone-layout.mjs`'s iPhone-13-class emulation,
 * `verify-mobile-mapfinder.mjs`, `verify-planner-pinch.mjs`) — captured here as a first-class,
 * always-on pass rather than a one-off script someone has to remember to write for the next bug.
 *
 * `deviceScaleFactor: 1` on BOTH viewports, deliberately not the phone's real ~3x — matches the
 * existing desktop capture's own reasoning (this file's `captureSurface` has always forced dpr:1
 * regardless of the real desktop's dpr) and keeps every baseline PNG the same pixel-per-CSS-px
 * scale, so the tolerance policy below (picked against dpr:1 desktop captures) doesn't need a
 * second calibration. `isMobile`/`hasTouch` are set together (Chromium requires them paired) so
 * any touch-vs-mouse-conditioned CSS/JS in the app renders the way it would on a real phone, not
 * a narrow desktop window.
 * ------------------------------------------------------------------------------------------- */
export const VIEWPORTS = [
  { id: "desktop", width: 1440, height: 900, deviceScaleFactor: 1, label: "Desktop (1440×900)" },
  {
    id: "phone", width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    label: "Phone (390×844, iPhone-class)",
  },
];

export function viewportIds() {
  return VIEWPORTS.map((v) => v.id);
}

export function findViewport(id) {
  const v = VIEWPORTS.find((x) => x.id === id);
  if (!v) throw new Error(`unknown viewport "${id}" — known: ${viewportIds().join(", ")}`);
  return v;
}

/* The manifest/report key for one theme+viewport pair. `desktop` is the ORIGINAL, un-suffixed
 * key (`"light"`/`"dark"`) so every already-approved desktop baseline — file name AND manifest
 * entry — is untouched by this change; only the new `phone` viewport gets a suffix. Keeping the
 * desktop key bare is what makes this additive rather than a forced re-approval of four PNGs
 * that didn't change a pixel. */
export function themeViewportKey(theme, viewportId) {
  if (!THEMES.includes(theme)) throw new Error(`unknown theme "${theme}" — expected one of ${THEMES.join(", ")}`);
  findViewport(viewportId);
  return viewportId === "desktop" ? theme : `${theme}--${viewportId}`;
}

/* The four minimum surfaces the brief named, each captured in both themes. Each entry is
 * everything the DOC generator needs (id/name/note); the Playwright half
 * (`ui-audit/visual-regression.mjs`) attaches its own `prep(page)` function per id — kept out of
 * this file so the file stays browser-free and unit-testable. */
export const SURFACES = [
  {
    id: "map-landing",
    name: "Map landing page (no project selected)",
    note: "The first screen a user sees — no project selected, MapFinder's default Site-mode search bar, " +
      "the Imagery & layers panel collapsed to its resting corner pill (the state the corner-pill styling " +
      "actually governs). Map tiles are served from a local deterministic fake-tile route (color is a pure " +
      "function of z/x/y, never the network) so the basemap never depends on a live GIS host.",
  },
  {
    id: "site-planner-header",
    name: "Site Planner — header + toolbar",
    note: "A local demo plan (no cloud project, no GIS origin — never touches the network) open and " +
      "zoomed to fit, no left-rail panel open. One shot covers the row-1/row-2 app header AND the tool " +
      "rail together, since both are always on screen at once in the real product.",
  },
  {
    id: "site-planner-left-rail",
    name: "Site Planner — left rail (Yield panel)",
    note: "Same demo plan as \"header + toolbar\", with the Yield panel open in the left rail — the " +
      "left-rail-panel surface the brief asked for by name.",
  },
  {
    id: "library",
    name: "Library",
    note: "The Library workspace with no files seeded — its empty state (deterministic; no upload " +
      "timestamps or live file listing to race against).",
  },
];

/* Named, not silently absent — the same discipline ui-inventory.mjs's own header uses for its
 * "NOT crawled" list. Every one of these is a real product surface this tool does not screenshot
 * yet, with the reason it is out of scope for a logged-out, network-free capture. */
export const NOT_COVERED = [
  "Any auth-gated or signed-in-only surface (cloud sync states, the account Storage tab, admin) — " +
    "this tool boots logged out by construction; these stay on VERIFICATION.md's live-verify list " +
    "per root CLAUDE.md's ATTEMPT-BEFORE-YOU-PARK rule.",
  "Document Review with a drawing actually open, and the Site Planner canvas chrome beyond the " +
    "header/tool-rail/left-rail already isolated above — both need a real loaded document/drawn " +
    "geometry this tool's bare demo plan does not carry.",
  "Any dialog/modal that only opens over real content (a delete confirmation, a share sheet).",
  "The Scheduler (public/sequence/index.html) — a separate, self-contained HTML document outside " +
    "the React tree and the design-token system entirely (see docs/DESIGN.md).",
  "Stitcher, Notes, Model — each needs its own seed data (a stitched aerial, a saved note, a model " +
    "sheet) this tool does not build.",
  "The map landing page's \"selected.length > 0\" state (a real parcel clicked) and any live GIS " +
    "feature response — needs a real parcel click against live GIS data, which this tool " +
    "deliberately routes to a local fake tile instead of the network (see the tolerance/masking " +
    "policy below), so that state never renders here.",
];

/* ---------------------------------------------------------------------------------------------
 * Tolerance policy.
 *
 * MEASURED, NOT ASSUMED (PERCEPTUAL-PARITY's own discipline, applied here even though this check
 * is deliberately cruder than that one — see the note below). `ui-audit/measure-visual-noise.mjs`
 * captures every surface/theme TWICE in a row against the identical build with nothing in the app
 * or the seed changed, and diffs each pair — that is the "same build, different run" noise floor a
 * tolerance has to sit above, or every PR would fail on its own harness's jitter. Recorded result
 * (see docs/VISUAL-REGRESSION.md's own "Noise floor" section for the dated run): 0 differing pixels
 * on all 8 surface/theme pairs, run twice. Fonts are self-hosted (no network font race), animations/
 * transitions are force-disabled before every screenshot, and map tiles are served from a pure
 * function of (z,x,y) rather than the network — so there is no discovered source of run-to-run
 * jitter to size a tolerance against. The tolerance below is therefore set just above true zero
 * (never AT zero — a zero-tolerance gate cannot distinguish "the picture changed" from "PNG
 * re-encoded one byte differently," and this repo's own pngDiff.mjs works in decoded RGB precisely
 * to avoid that trap) rather than padded for an observed noise source that was measured and not
 * found. If a real noise source turns up later (a driver/OS font-rendering difference between this
 * sandbox and the actual GitHub Actions runner, say), raise this number and record why — the same
 * "never pad speculatively, raise it against a name" discipline PERCEPTUAL-PARITY states outright.
 *
 * ⛔ DELIBERATELY NOT PERCEPTUAL-PARITY'S ΔE00 BAR. That bar exists to let an INTENTIONAL,
 * imperceptible rendering change (an antialiasing edge, a sub-pixel nudge) through without a human
 * in the loop — the right bar for a change someone is actively shipping and already believes is
 * invisible. This check exists for the opposite case: ANY committed baseline is a promise that nothing
 * about that surface changes without a human looking at the diff and re-approving it. So the bar
 * here is a noise floor, not a visibility floor — it exists only to absorb genuine PNG/rendering
 * jitter, never to wave through a change a person hasn't seen.
 * ------------------------------------------------------------------------------------------- */
export const TOLERANCE = {
  // Fraction of pixels allowed to differ at all (by any nonzero amount) before a surface fails.
  maxDiffPct: 0.02,
  // The worst single-channel (0-255) delta any differing pixel may show.
  maxChannelDelta: 8,
};

export function surfaceIds() {
  return SURFACES.map((s) => s.id);
}

export function findSurface(id) {
  const s = SURFACES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown surface "${id}" — known: ${surfaceIds().join(", ")}`);
  return s;
}

/** Baseline PNG filename for one surface/theme/viewport triple — the one place this naming is
 *  decided. `viewportId` defaults to `"desktop"`, which produces the ORIGINAL, un-suffixed
 *  filename (`${surfaceId}--${theme}.png`) every already-approved baseline already uses. */
export function baselineFile(surfaceId, theme, viewportId = "desktop") {
  if (!THEMES.includes(theme)) throw new Error(`unknown theme "${theme}" — expected one of ${THEMES.join(", ")}`);
  findSurface(surfaceId); // throws on an unknown id, naming the valid ones
  findViewport(viewportId); // throws on an unknown id, naming the valid ones
  const suffix = viewportId === "desktop" ? "" : `--${viewportId}`;
  return `${surfaceId}--${theme}${suffix}.png`;
}

/**
 * Pass/fail verdict for one surface/theme's diff. `stats` is `diffImages()`'s return shape from
 * ui-audit/lib/pngDiff.mjs, or `null` for "0 differing pixels" (diffImages only returns a bbox/
 * non-zero fields when something actually differs, but callers may also pass null directly for the
 * trivially-identical case rather than constructing a zero object).
 */
export function evaluateDiff(stats, tolerance = TOLERANCE) {
  if (!stats || !stats.differing) {
    return { pass: true, reason: "identical (0 differing pixels)" };
  }
  const pass = stats.pct <= tolerance.maxDiffPct && stats.maxDelta <= tolerance.maxChannelDelta;
  const bboxNote = stats.bbox ? ` — changed region x${stats.bbox.x},y${stats.bbox.y} ${stats.bbox.w}x${stats.bbox.h}` : "";
  if (pass) {
    return { pass: true, reason: `within tolerance (${stats.pct}% of pixels differ, worst channel delta ${stats.maxDelta})` };
  }
  return {
    pass: false,
    reason: `EXCEEDS tolerance — ${stats.pct}% of pixels differ (limit ${tolerance.maxDiffPct}%), ` +
      `worst channel delta ${stats.maxDelta} (limit ${tolerance.maxChannelDelta})${bboxNote}`,
  };
}

/**
 * The generated `docs/VISUAL-REGRESSION.md` content, built entirely from the approval manifest —
 * see the file header for why it must never read from a live capture's diff numbers.
 *
 * `manifest` shape: { tolerance, surfaces: { [surfaceId]: { [themeViewportKey]: { approvedAt,
 * approvedCommit, note } } } } — `themeViewportKey(theme, viewportId)` above is the one function
 * that decides the key (bare `theme` for the desktop viewport, `${theme}--${viewportId}`
 * otherwise), so every already-approved desktop entry's key is untouched by adding a viewport.
 * `noiseFloor` is a short, hand-recorded string describing the last noise-floor measurement run
 * (dated), reported verbatim rather than re-measured on every doc build.
 */
export function buildStatusMarkdown({ manifest, noiseFloor, addedCiTimeNote }) {
  const tol = manifest?.tolerance || TOLERANCE;
  const lines = [
    "# `docs/VISUAL-REGRESSION.md` — visual regression baselines (NEW-1)",
    "",
    "**Generated by `node ui-audit/visual-regression.mjs --approve` — do not hand-edit.** `--check` " +
      "fails CI if this file drifts from what the current surface list + approval manifest would " +
      "produce, so it can never go stale relative to `ui-audit/visual-baselines/manifest.json`.",
    "",
    "## What this is",
    "",
    "Every PR renders the surfaces below, in both themes, and diffs each render pixel-for-pixel " +
      "against a human-approved baseline image checked into `ui-audit/visual-baselines/`. It needs no " +
      "theory of what \"wrong\" looks like — only that the screen changed. A PR that changes a pixel " +
      "beyond the noise-floor tolerance below fails CI until a person looks at the diff and either " +
      "fixes the regression or approves the new picture as the baseline (see \"Approving an intentional " +
      "change\").",
    "",
    "## Coverage",
    "",
    `Rendered in **both light and dark theme, at both viewports** (${SURFACES.length} surfaces × ` +
      `${THEMES.length} themes × ${VIEWPORTS.length} viewports = ` +
      `${SURFACES.length * THEMES.length * VIEWPORTS.length} baseline images):`,
    "",
    ...SURFACES.map((s) => `- **${s.name}** (\`${s.id}\`) — ${s.note}`),
    "",
    "**Viewports** (NEW-2, 2026-09-03 — added after a phone-width layout defect, the update " +
      "banner squeezed to an unreadable sliver, shipped with every prior visual gate green: " +
      "nothing this file ever rendered was narrower than 1440px):",
    "",
    ...VIEWPORTS.map((v) => `- **${v.label}** (\`${v.id}\`)`),
    "",
    "**Not covered, named rather than silently absent:**",
    "",
    ...NOT_COVERED.map((n) => `- ${n}`),
    "",
    "## Determinism — what's masked, and why",
    "",
    "A screenshot diff is only trustworthy if the only thing that can move it is a real code change. " +
      "Five sources of pixel noise are neutralized before every capture, not papered over with a loose " +
      "tolerance:",
    "",
    "- **Map tiles.** Every basemap tile request is routed to a local, deterministic fake tile " +
      "(`ui-audit/lib/fakeTile.mjs` — color is a pure function of the tile's z/x/y, already used " +
      "elsewhere in this repo for the same reason) instead of a real GIS/imagery host. A live tile " +
      "host varies by imagery vintage, server load and this sandbox's own egress restrictions — none " +
      "of that may ever decide whether a PR is green. Every other cross-origin request (GIS feature " +
      "queries, any analytics beacon) is aborted outright for the same reason; the app's own local " +
      "fonts/scripts/styles are same-origin and untouched.",
    "- **Animations & transitions.** Forced to zero duration/delay via an injected stylesheet before " +
      "every screenshot, so an in-flight hover/open transition can never be caught mid-frame.",
    "- **Fonts.** The capture waits on `document.fonts.ready` before screenshotting. Moot in practice — " +
      "this app self-hosts its one font family (`/fonts/inter-*.woff2`, see `src/index.css`) rather " +
      "than pulling from a font CDN — but asserted rather than assumed.",
    "- **Live/time-based data.** Every surface is reached logged out, with a local-only demo plan that " +
      "carries no cloud project and no GIS origin, so no \"saved Xs ago\"/cloud-sync-state text and no " +
      "live GIS response ever enters a captured frame.",
    "- **Build-time Supabase-configured state (MEASURED, not assumed — B1026272's own second real CI " +
      "failure).** `supabaseConfigured()` (`src/workspaces/site-planner/lib/supabase.js`) is a pure " +
      "truthy-string check on `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` at BUILD time, no live " +
      "network call — but its result changes what the header's account chip renders (\"Cloud off\" " +
      "unconfigured vs. \"Sign in\" configured-but-signed-out), and CI's `build.yml` sets these to real " +
      "repo secrets. A baseline built with no Supabase env vars at all mismatched CI's real build on " +
      "every single surface, in exactly the same top-right region, confirmed byte-for-byte identical " +
      "to CI's own failure once reproduced locally with a dummy-but-truthy value. So: **always build " +
      "with SOME truthy `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` when capturing or approving a " +
      "baseline** (see \"Approving an intentional change\" below) — the exact value never matters, " +
      "only whether the check reads it as configured, matching CI's real structural state.",
    "",
    `**Noise floor, measured rather than assumed:** ${noiseFloor}`,
    "",
    `**Tolerance:** up to **${tol.maxDiffPct}%** of pixels may differ, and no differing pixel may be more ` +
      `than **${tol.maxChannelDelta}/255** off on any single color channel, before a surface is failed. ` +
      "Set just above the measured noise floor (which was 0), never padded for a source of jitter that " +
      "was never found — see `ui-audit/lib/visualBaseline.mjs`'s own header for the full reasoning, " +
      "including why this is deliberately NOT the same ΔE00 perceptual bar `PERCEPTUAL-PARITY` uses for " +
      "intentional LOD-class changes: a baseline is a promise nothing changes unseen, not a claim that a " +
      "change is invisible.",
    "",
    "## Approving an intentional change",
    "",
    "When a PR's diff is real and the new picture is the one you want:",
    "",
    "1. Build and serve the app locally with the SAME build-time Supabase-configured state CI uses " +
      "(see \"Determinism\" below — `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are real secrets in " +
      "CI's build step, and their mere PRESENCE, not their value, flips the account chip from " +
      "\"Cloud off\" to \"Sign in\"): " +
      "`VITE_SUPABASE_URL=\"https://visual-regression.supabase.co\" " +
      "VITE_SUPABASE_ANON_KEY=\"visual-regression-dummy-key\" npx vite build && " +
      "npx vite preview --port 4173` (preview in a second terminal, or backgrounded). Any truthy dummy " +
      "value works — no live Supabase call ever happens in a signed-out screenshot.",
    "2. Run `BASE_URL=http://localhost:4173/ node ui-audit/visual-regression.mjs --approve " +
      "--reason=\"why this changed\"`. This re-captures every surface/theme, overwrites the baseline " +
      "PNGs that actually changed, updates `ui-audit/visual-baselines/manifest.json` (records the " +
      "commit the new baseline was captured against, the date, and your one-line reason), and " +
      "regenerates this file. `--reason` is required — there is no default, because a baseline change " +
      "with no stated reason is exactly the silent drift this check exists to prevent.",
    "3. Commit the changed PNGs, the manifest, and this file together with your code change, and open " +
      "the PR as usual.",
    "",
    "**The approval record is the PR itself** — the diff shows exactly which baseline images changed " +
      "and the manifest entry records who/when/why, and a human reviewer approves it the same way they " +
      "approve any other code change in this repo. There is no separate approval system to keep in sync.",
    "",
    "## Authoring baselines from CI (B1171504)",
    "",
    "A locally-rendered baseline — even one captured with the exact CI-pinned Chromium revision — does " +
      "not reliably byte-match what this repo's real GitHub Actions runner renders: font hinting and " +
      "antialiasing differ between a sandbox's container image and the runner's image below what any " +
      "locally-available browser build can close. Measured twice: a prior baseline re-approval with the " +
      "pinned revision shipped clean in its own sandbox and then failed the very next real CI run on " +
      "every surface/theme/viewport pair, and a separate PR carrying one small, universal control failed " +
      "an identical 0.29–2.72% signature against this file's 0.02% tolerance on two separate local " +
      "approval attempts. **A value nobody can reproduce locally must never be a merge gate** — so when " +
      "a real, intentional visual change can't be approved locally with confidence, let CI author its " +
      "own baseline instead of guessing at the picture it will judge:",
    "",
    "1. Push the branch with its real code change (no baseline edits needed).",
    "2. From the Actions tab, run **Authorize visual regression baselines** " +
      "(`.github/workflows/authorize-visual-baselines.yml`) against that branch, with a `reason` " +
      "input describing why the pictures are changing. It is `workflow_dispatch`-only — it never " +
      "runs on an ordinary push — and it refuses outright if pointed at `main`.",
    "3. It builds and renders the app on the SAME runner image and Chromium revision the required " +
      "`build` check's gate uses, runs `--approve` against its own render, and pushes the resulting " +
      "PNGs/manifest/this file back to the SAME branch as an ordinary commit.",
    "4. The PR's `build` check then re-runs against that commit (nudge it per this repo's own " +
      "automation-push quirk in `CLAUDE.md` → \"Workflow & deploy\" if it stays at \"Expected\") and " +
      "judges the CI-authored picture — the same gate, same tolerance, same tables below, just " +
      "rendered by the only environment qualified to render it.",
    "",
    "**This changes who renders the picture, never what \"pass\" means.** The tolerance, the pass/fail " +
      "comparison, and the phone-viewport structural gate are the exact same code either way — a CI-" +
      "authored baseline is reviewed in the PR diff exactly like a hand-approved one, and a later commit " +
      "that actually changes a control's geometry still fails the gate with real, visible numbers.",
    "",
    "## Current baselines",
    "",
    "| surface | theme | viewport | last approved | at commit | note |",
    "|---|---|---|---|---|---|",
  ];
  for (const s of SURFACES) {
    for (const theme of THEMES) {
      for (const v of VIEWPORTS) {
        const key = themeViewportKey(theme, v.id);
        const entry = manifest?.surfaces?.[s.id]?.[key];
        if (!entry) {
          lines.push(`| ${s.name} | ${theme} | ${v.id} | _(no baseline yet)_ | — | — |`);
        } else {
          lines.push(`| ${s.name} | ${theme} | ${v.id} | ${entry.approvedAt} | \`${entry.approvedCommit}\` | ${entry.note} |`);
        }
      }
    }
  }
  lines.push("", `**Added CI time:** ${addedCiTimeNote}`, "");
  return lines.join("\n");
}
