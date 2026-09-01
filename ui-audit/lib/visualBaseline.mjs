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

/** Baseline PNG filename for one surface/theme pair — the one place this naming is decided. */
export function baselineFile(surfaceId, theme) {
  if (!THEMES.includes(theme)) throw new Error(`unknown theme "${theme}" — expected one of ${THEMES.join(", ")}`);
  findSurface(surfaceId); // throws on an unknown id, naming the valid ones
  return `${surfaceId}--${theme}.png`;
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
 * `manifest` shape: { tolerance, surfaces: { [surfaceId]: { [theme]: { approvedAt, approvedCommit,
 * note } } } }. `noiseFloor` is a short, hand-recorded string describing the last noise-floor
 * measurement run (dated), reported verbatim rather than re-measured on every doc build.
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
    `Rendered in **both light and dark theme** (${SURFACES.length} surfaces × ${THEMES.length} ` +
      `themes = ${SURFACES.length * THEMES.length} baseline images):`,
    "",
    ...SURFACES.map((s) => `- **${s.name}** (\`${s.id}\`) — ${s.note}`),
    "",
    "**Not covered, named rather than silently absent:**",
    "",
    ...NOT_COVERED.map((n) => `- ${n}`),
    "",
    "## Determinism — what's masked, and why",
    "",
    "A screenshot diff is only trustworthy if the only thing that can move it is a real code change. " +
      "Four sources of pixel noise are neutralized before every capture, not papered over with a loose " +
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
    "1. Build and serve the app locally: `npx vite build && npx vite preview --port 4173` (in a second " +
      "terminal, or backgrounded).",
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
    "## Current baselines",
    "",
    "| surface | theme | last approved | at commit | note |",
    "|---|---|---|---|---|",
  ];
  for (const s of SURFACES) {
    for (const theme of THEMES) {
      const entry = manifest?.surfaces?.[s.id]?.[theme];
      if (!entry) {
        lines.push(`| ${s.name} | ${theme} | _(no baseline yet)_ | — | — |`);
      } else {
        lines.push(`| ${s.name} | ${theme} | ${entry.approvedAt} | \`${entry.approvedCommit}\` | ${entry.note} |`);
      }
    }
  }
  lines.push("", `**Added CI time:** ${addedCiTimeNote}`, "");
  return lines.join("\n");
}
