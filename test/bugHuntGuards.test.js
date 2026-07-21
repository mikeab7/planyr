import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* Anti-drift guards for the 2026-06-27 bug-hunt fixes (B505–B509). These files are edited
 * by many concurrent sessions; a string-level check fails loudly if a merge silently reverts
 * a fix. Each guard points at the exact defect the bug-hunt confirmed. */
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("bug-hunt B505–B509: the fixes still exist in source", () => {
  it("B505: Stitcher loadStitch consumes the request on rejection too (.catch)", () => {
    const src = read("../src/workspaces/doc-review/Stitcher.jsx");
    expect(src).toMatch(/loadStitch\(loadReq\)\.then\(/);
    expect(src).toMatch(/\.catch\(\(\) => onConsumeLoad && onConsumeLoad\(\)\)/);
  });

  it("B506/B507: both device-full cloud pushes have a rejection path (.catch)", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(src).toMatch(/\}\)\.catch\(\(\) => \{ setSaveStatus\("unsaved"\); setSavedToCloudOnly\(false\); setCloudSaveFailed\(true\); \}\);/); // B506
    expect(src).toMatch(/\}\)\.catch\(\(\) => \{ setSaveNowMsg\(""\); setLocalSaveFailed\(true\); setSavedToCloudOnly\(false\); \}\);/);     // B507
  });

  it("B508: LayerPanel relevance control uses theme tokens, not hardcoded hex", () => {
    const src = read("../src/workspaces/site-planner/components/LayerPanel.jsx");
    expect(src).not.toMatch(/#3b3a36|#fbfaf6|#b45309/);                       // the old hardcoded warm-dark hexes
    expect(src).toMatch(/active \? "var\(--accent\)" : "transparent"/);       // tokenized active fill
    expect(src).toMatch(/var\(--warn-text\)/);                               // warn text stays a theme token (out-of-coverage caption)
    // B760 moved the stale stamp behind the per-row ⓘ: the stale → "warn" tone is decided in
    // the pure layerPanelInfo module and RowInfo renders that tone with the --warn-text token.
    // The theme token stays the single source of warn text across ALL three files (never a hex).
    const info = read("../src/workspaces/site-planner/lib/layerPanelInfo.js");
    expect(info).toMatch(/ls && ls\.stale \? "warn"/);                       // stale → warn tone
    const rowInfo = read("../src/workspaces/site-planner/components/RowInfo.jsx");
    expect(rowInfo).not.toMatch(/#b45309|#8a5410|#efb54e/i);                 // no hardcoded amber
    expect(rowInfo).toMatch(/tone === "warn" \? "var\(--warn-text\)"/);      // warn tone → theme token
  });

  it("B522: the Mapillary proxy clamps a no-body upstream status instead of forwarding it", () => {
    const src = read("../functions/api/mapillary/[[path]].js");
    expect(src).toMatch(/resp\.status !== 204 && resp\.status !== 304/);
  });

  it("B523: the /api/file proxy clamps a no-body upstream status", () => {
    const src = read("../functions/api/file.js");
    expect(src).toMatch(/resp\.status !== 204 && resp\.status !== 304/);
  });

  it("B525: the ProjectBreadcrumb cloud-warn row uses theme tokens, not hardcoded amber hex", () => {
    const src = read("../src/shared/ui/ProjectBreadcrumb.jsx");
    expect(src).not.toMatch(/#fef3c7|#92400e/);
    expect(src).toMatch(/color: "var\(--warn-text\)"/);
  });

  it("B526: ToolRail uses theme tokens, not a permanently-dark hardcoded chrome", () => {
    const src = read("../src/shared/ui/ToolRail.jsx");
    expect(src).not.toMatch(/#191613|#ece7db|#9b9482|#2e2a23/);
    expect(src).toMatch(/CHROME = "var\(--surface-raised\)"/);
  });

  // B527's guard (Project Files drawer dark-mode theming) was retired with the drawer itself:
  // the redundant 🗂 Files button + ProjectFilesDrawer.jsx were removed once the Library tab
  // replaced them (B497). No component left to theme-guard.

  it("B517: the TxRRC well/pipeline overlay no longer points at the retired Harris-clipped host", () => {
    const src = read("../src/workspaces/site-planner/lib/layers.js");
    expect(src).not.toMatch(/gis\.hctx\.net\/arcgishcpid\/rest\/services\/TXRRC/); // retired, ~99.8% incomplete outside Harris
    expect(src).toMatch(/gis\.rrc\.texas\.gov\/server\/rest\/services\/rrc_public/); // authoritative statewide RRC service
  });

  it("B533: 3DEP elevation converts metres with the US survey foot, not the international foot", () => {
    const src = read("../src/workspaces/site-planner/lib/elevation.js");
    expect(src).not.toMatch(/M_TO_FT = 3\.280839895/);   // the international-foot constant
    expect(src).toMatch(/M_TO_FT = 3937 \/ 1200/);        // US survey foot, matching the EPSG:2278 spine
  });

  it("B603/B703: the 3DEP elevation overlay uses a view-relative DRA chain, not a fixed national tint", () => {
    const src = read("../src/workspaces/site-planner/lib/layers.js");
    // The USGS press-release PROSE ("Elevation Tinted Hillshade") is NOT a valid
    // rasterFunctionInfos[].name — exportImage errors on it and the overlay renders blank
    // (the B603 bug). Any future STRING here must exactly match a published template name.
    expect(src).not.toMatch(/rendering: "Elevation Tinted Hillshade"/);
    // B703 superseded the named template entirely: a fixed-national-ramp tint paints the
    // whole Houston MSA one flat green band. The rule must stay a custom chain with DRA
    // (per-export re-stretch) — probe-verified against the live service 2026-07-07.
    expect(src).not.toMatch(/rendering: "Hillshade Elevation Tinted"/);
    expect(src).toMatch(/rasterFunction: "Stretch"/);
    expect(src).toMatch(/DRA: true/);
    expect(src).toMatch(/rasterFunction: "Colormap"/);
  });

  it("B534/B535: the Doc Review boot-resume IIFEs handle their own rejection (no unhandled promise)", () => {
    // The boot-resume IIFEs must swallow their own rejection (.catch) — and since the
    // per-project last-doc work they ALSO arm the pointer writes afterwards (.finally),
    // so the guard matches the catch-then-finally chain shape.
    const stitch = read("../src/workspaces/doc-review/Stitcher.jsx");
    const dr = read("../src/workspaces/doc-review/DocReview.jsx");
    expect(stitch).toMatch(/\}\)\(\)\.catch\(\(\) => \{\}\) \/\/ B534/);
    expect(stitch).toMatch(/\.finally\(\(\) => setBootResolved\(true\)\)/);
    expect(dr).toMatch(/\}\)\(\)\.catch\(\(\) => \{\}\) \/\/ B535/);
    expect(dr).toMatch(/\.finally\(\(\) => setBootResolved\(true\)\)/);
  });

  it("B536: addGroup skips a failed page render and reports it (no silent group-drop abort)", () => {
    const src = read("../src/workspaces/doc-review/Stitcher.jsx");
    expect(src).toMatch(/renderFailed/);
    expect(src).toMatch(/catch \(_\) \{ renderFailed\.push/);
  });

  it("B538: fracToNum guards a zero denominator (no Infinity/NaN leak)", () => {
    const src = read("../src/shared/files/sheetScale.js");
    expect(src).toMatch(/d === 0 \? 0 :/);
  });

  it("B539: currentAccessToken parses each auth-token entry inside its own try (a corrupt one doesn't abort the scan)", () => {
    const src = read("../src/workspaces/site-planner/lib/supabase.js");
    // the JSON.parse now lives inside a nested try whose catch continues the loop
    expect(src).toMatch(/corrupt entry — skip and keep scanning/);
  });

  it("B530: AuthPanel modals close on Escape and announce as a dialog", () => {
    const src = read("../src/workspaces/site-planner/components/AuthPanel.jsx");
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/e\.key === "Escape"/);
  });

  it("B531: the ReviewsBar row and the SitePlanner Section header are keyboard-reachable", () => {
    const rb = read("../src/workspaces/doc-review/components/ReviewsBar.jsx");
    expect(rb).toMatch(/role="button" tabIndex=\{0\}/);
    expect(rb).toMatch(/e\.key === "Enter" \|\| e\.key === " "/);
    const sp = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(sp).toMatch(/className="sec-head"[\s\S]{0,200}role="button" tabIndex=\{0\} aria-expanded=\{open\}/);
  });

  it("B532: the Site review modal closes on Escape and announces as a dialog", () => {
    const src = read("../src/workspaces/site-planner/components/SiteReviewModal.jsx");
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/e\.key === "Escape"/);
  });

  it("B528: Doc Review upsertReview serializes per-id writes (no false self-conflict)", () => {
    const src = read("../src/workspaces/doc-review/lib/reviewStore.js");
    expect(src).toMatch(/makeWriteSerializer/);
    expect(src).toMatch(/serializeReviewWrite\(record\.id, \(\) => upsertReviewCore\(record\)\)/);
  });

  it("B529: Site Planner cloudUpsert serializes per-id writes (no false self-conflict)", () => {
    const src = read("../src/workspaces/site-planner/lib/cloudSync.js");
    expect(src).toMatch(/makeWriteSerializer/);
    expect(src).toMatch(/serializeSiteWrite\(model\.id, \(\) => cloudUpsertCore\(uid, model\)\)/);
  });

  it("B540: geocodeAddress distinguishes 'unreachable' from 'not found' (returns { error } vs null)", () => {
    const src = read("../src/workspaces/site-planner/lib/geocode.js");
    expect(src).toMatch(/reachedAny/);
    expect(src).toMatch(/return reachedAny \? null : \{ error:/);
    // both callers handle the { error } shape
    expect(read("../src/workspaces/site-planner/MapFinder.jsx")).toMatch(/hit && hit\.error/);
    expect(read("../src/workspaces/site-planner/SitePlanner.jsx")).toMatch(/hit && hit\.error/);
  });

  it("B541: CloudSyncBadge boundary resets via resetKey, not a remount key (popover survives state churn)", () => {
    const src = read("../src/shared/ui/CloudSyncBadge.jsx");
    expect(src).not.toMatch(/<CloudBadgeBoundary key=/);     // no longer remounted on every state change
    expect(src).toMatch(/resetKey=\{String\(state/);          // passes a reset signal instead
    expect(src).toMatch(/prevProps\.resetKey !== this\.props\.resetKey/); // and clears a crash on its change
  });

  it("B544: PDF export revokes its blob URL immediately (no 8s leak window)", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(src).not.toMatch(/setTimeout\(\(\) => URL\.revokeObjectURL\(aEl\.href\), 8000\)/);
    expect(src).toMatch(/URL\.revokeObjectURL\(aEl\.href\); \/\/ B544/);
  });

  it("B545: MapFinder address search is guarded by a request-token (no stale-response clobber)", () => {
    const src = read("../src/workspaces/site-planner/MapFinder.jsx");
    expect(src).toMatch(/addrTokRef = useRef\(0\)/);
    expect(src).toMatch(/const tok = \+\+addrTokRef\.current/);
    expect(src).toMatch(/if \(tok !== addrTokRef\.current\) return/);
  });

  it("B546: Stitcher calibration display guards a non-finite ftPerUnit + commitCalibrate rejects u<1", () => {
    const src = read("../src/workspaces/doc-review/Stitcher.jsx");
    expect(src).toMatch(/Number\.isFinite\(ftPerUnit\) && ftPerUnit/);
    expect(src).toMatch(/if \(!\(u >= 1\)\)/);
  });

  it("B547: Stitcher takeoff totals guard against a NaN/Infinity rollup", () => {
    const src = read("../src/workspaces/doc-review/Stitcher.jsx");
    expect(src).toMatch(/Number\.isFinite\(totals\.areaSf\)/);
    expect(src).toMatch(/Number\.isFinite\(totals\.distFt\)/);
  });

  it("B551: Stitcher releases pointer capture on a blur/visibility abort (passes the pointerId)", () => {
    const src = read("../src/workspaces/doc-review/Stitcher.jsx");
    expect(src).toMatch(/panY: view\.panY, pointerId: e\.pointerId/);          // pan stores the pointerId
    expect(src).toMatch(/if \(drag\.current\) abortGesture\(drag\.current\.pointerId\)/); // recover passes it
  });

  it("B552: pendingLegacyCount delegates to pendingLegacySites (count == list == import)", () => {
    const src = read("../src/workspaces/site-planner/lib/storage.js");
    expect(src).toMatch(/return pendingLegacySites\(uid\)\.length/);
    expect(src).not.toMatch(/for \(const \[id, rec\] of Object\.entries\(legacy\)\)/); // the old over-counting loop is gone
  });

  it("B557: account email renders are null-guarded (no 'undefined' in the pill/profile)", () => {
    // The account pill moved out of Shell into AccountControl (B734); the null-guard rode with it.
    expect(read("../src/app/AccountControl.jsx")).toMatch(/Signed in as \$\{user\?\.email \|\| "\(no email\)"\}/);
    expect(read("../src/workspaces/site-planner/components/AuthPanel.jsx")).toMatch(/\{user\?\.email \|\| "\(no email\)"\}/);
  });

  it("B734: the account dropdown closes on workspace navigation (hashchange) so it can't linger over another workspace", () => {
    // Every module switch (incl. browser Back/Forward — the one nav a click-away backdrop can't
    // catch) goes through window.location.hash -> fires hashchange. AccountControl closes its portal
    // menu on that event so a kept-alive-but-hidden instance's flyout can't hang over the new tab.
    const src = read("../src/app/AccountControl.jsx");
    expect(src).toMatch(/addEventListener\("hashchange", close\)/);
    expect(src).toMatch(/const close = \(\) => setAcctOpen\(false\)/);
  });

  it("B557: layers.js clears the feature-retry timer on removal + guards the cache-age fetch", () => {
    const src = read("../src/workspaces/site-planner/lib/layers.js");
    expect(src).toMatch(/lyr\.onRemove = function \(map\) \{ clearTimeout\(timer\)/); // retry timer cleanup
    expect(src).toMatch(/typeof m\.ts === "number" && lyr && lyr\._map/);             // stale-callback guard
  });

  it("B557: LayerPanel group + reveal toggles announce aria-expanded", () => {
    const src = read("../src/workspaces/site-planner/components/LayerPanel.jsx");
    expect(src).toMatch(/aria-expanded=\{!collapsed\[g\]\}/);
    expect(src).toMatch(/aria-expanded=\{!!revealHidden\[groupKey\]\}/);
  });

  it("B557: ProjectBreadcrumb manage menu has role=menu + menuitem", () => {
    const src = read("../src/shared/ui/ProjectBreadcrumb.jsx");
    // B915: the menu now renders through the shared <ContextMenu>, which applies role/aria-label
    // from props — so the guard matches the prop form (rendered output is unchanged).
    expect(src).toMatch(/role="menu" ariaLabel="Project actions"/);
    expect((src.match(/role="menuitem"/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("B559: timestamp comparisons coerce via toMs (newer-wins merge + legacy-prune are type-safe)", () => {
    const sm = read("../src/workspaces/site-planner/lib/siteModel.js");
    expect(sm).toMatch(/export const toMs = /);
    expect(sm).toMatch(/toMs\(A\.updatedAt\) >= toMs\(B\.updatedAt\)/);
    const st = read("../src/workspaces/site-planner/lib/storage.js");
    expect(st).toMatch(/toMs\(cloudMap\[id\]\.updatedAt\) >= toMs\(legacy\[id\] && legacy\[id\]\.updatedAt\)/);
  });

  it("B562: importLegacyIntoCloud compares timestamps via toMs (third sibling of B559)", () => {
    const st = read("../src/workspaces/site-planner/lib/storage.js");
    // the legacy-import skip guard must coerce both sides so an ISO-string updatedAt can't NaN the compare
    expect(st).toMatch(/toMs\(existing\.updatedAt\) >= toMs\(local\.updatedAt\)/);
    // and the raw, type-unsafe form must be gone from that path
    expect(st).not.toMatch(/\(existing\.updatedAt \|\| 0\) >= \(local\.updatedAt \|\| 0\)/);
  });

  it("B563: version restore re-applies parcelDrawings (its own persistence path) so it isn't a mixed-version restore", () => {
    const sp = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // the per-parcel Attached-Drawings UI was removed, but parcelDrawings still rides its own
    // persistence path and MUST survive a version restore — durably re-applied via a saveSite merge
    // ({...existing, ...partial} preserves the rest), so restore isn't a mixed-version state.
    expect(sp).toMatch(/saveSite\(\{ id: siteId, parcelDrawings: v\.parcelDrawings \|\| \[\] \}\)/);
  });

  it("B509: PropertyPanel threads the caption as aria-label to every control", () => {
    const src = read("../src/shared/markup/PropertyPanel.jsx");
    // each control receives label={label}
    for (const ctl of ["ColorControl", "NumberControl", "RangeControl", "EnumControl"]) {
      expect(src).toMatch(new RegExp(`<${ctl}[^>]*label=\\{label\\}`));
    }
    // and applies it as aria-label on its input/select
    expect((src.match(/aria-label=\{label\}/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});

describe("markup hit-area / callout padding / live color picker (B155 open-path tranche, B566, B567)", () => {
  it("B155: line + polyline markups carry a transparent FAT hit-stroke (not just the 2px visible line)", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(src).toMatch(/const MK_HIT_PX = 12;/);                                  // ~6px each side
    // both open-path branches render the wide pointer-catching companion stroke
    expect((src.match(/strokeWidth=\{MK_HIT_PX\}[^>]*pointerEvents="stroke"/g) || []).length).toBeGreaterThanOrEqual(2);
    // the line branch is no longer a bare stroke-only <line {...common} />
    expect(src).not.toMatch(/if \(m\.kind === "line"\) \{ const a = f2p\(m\.a\), b = f2p\(m\.b\); return <line key=\{m\.id\}[^>]*\{\.\.\.common\} \/>; \}/);
  });

  it("B566: callout/text-box default horizontal padding is more generous than vertical", () => {
    const sp = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(sp).toMatch(/padX: c\.padX \?\? 14, padY: c\.padY \?\? 8/);             // Site Planner default
    const mr = read("../src/shared/markup/MarkupRenderer.jsx");
    expect(mr).toMatch(/const padX = 8, padY = 4;/);                              // Doc Review parity — constant unchanged
    // Callout overflow fix (Doc Review): the char-count guess (`text.length * fs * 0.58 + padX*2`)
    // that let a callout's text render past its box was replaced with the real wrap-and-measure
    // box-fit (textWrap.calloutBoxMetrics) — assert the box is sized from that, not a flat guess.
    expect(mr).not.toMatch(/text\.length \* fs \* 0\.58 \+ padX \* 2/);
    expect(mr).toMatch(/calloutBoxMetrics\(text, fs, \{ padX, padY, measure \}\)/);
    // The Site Planner map's OWN callout system already got box-fit + wrapping via B913's
    // calloutLayout (auto-size / wrap-to-boxW), NOT this shared helper — assert it sizes from
    // calloutLayout and no longer uses the old flat char-count guess.
    expect(sp).toMatch(/calloutLayout\(c, st, view\.ppf\)/);
    expect(sp).not.toMatch(/tw = Math\.max\(fontPx, \.\.\.lines\.map\(\(l\) => l\.length \* charW\)\)/);
  });

  it("B567: every Site Planner color input picks live via livePick (onInput), with one-frame undo", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // livePick now takes an optional hist flag (default on); Standards-default swatches pass false
    // so a settings-only pick doesn't leave a dead undo frame (RC-6). Element/markup pickers are
    // unchanged — they still push one frame per picking session.
    expect(src).toMatch(/const livePick = \(apply, hist = true\) =>/);
    expect(src).toMatch(/onInput:\s+\(e\) => \{ if \(hist && !pickSnapRef\.current\) \{ pushHistory\(\); pickSnapRef\.current = true; \}/);
    // all 18 native color controls still spread livePick instead of a bare onChange
    // (B740 added the shared multi-selection Fill/Outline pickers — one colorField reused twice;
    //  the parcel Boundary panel added a per-parcel Outline-color picker → 14th;
    //  B929 added the Standards → Parcels default Outline-color + Fill-color swatches → 15th/16th;
    //  FINAL UI SPEC A1.6 moved the pond Properties into the inspector's "Appearance" group —
    //  its Fill + Outline pickers are a second copy alongside the non-pond Properties section → 17th/18th)
    expect((src.match(/\{\.\.\.livePick\(\(v\) =>/g) || []).length).toBe(18);
    // the two Standards element-Colors swatches opt out of history (settings-only, RC-6)
    expect((src.match(/\{\.\.\.livePick\(\(v\) => liveTypeStyle\([^)]*\), false\)\}/g) || []).length).toBe(2);
    // B929: the two Standards → Parcels default swatches are settings-only too (hist=false)
    expect((src.match(/\{\.\.\.livePick\(\(v\) => setParcelStd\([^)]*\), false\)\}/g) || []).length).toBe(2);
    // the per-pixel undo floods are gone: the OLD color-input handlers (inline pushHistory) no
    // longer exist (discrete controls like the "Fill the parcel" checkbox keep their pushHistory)
    expect(src).not.toMatch(/onChange=\{\(e\) => \{ pushHistory\(\); setSelEl\(\{ fill: e\.target\.value/);
    expect(src).not.toMatch(/onChange=\{\(e\) => \{ pushHistory\(\); setSelParcel\(\{ fill: e\.target\.value/);
    // and NO native color input is left on a bare onChange (the actual invariant)
    expect(src).not.toMatch(/type="color"[^>]*onChange=/);
    // WYSIWYG: a SELECTED neutral markup shows its REAL stroke (nStroke), not the accent tint —
    // otherwise a live stroke-color change would be hidden under the selection highlight.
    expect(src).toMatch(/const nStroke = m\.stroke;/);
    expect(src).toMatch(/const nsw = sw \+ \(isSel \? 1 : 0\);/);
    // B617: the on-screen width is the zoom-scaled vsw (held constant relative to the drawing).
    expect(src).toMatch(/const common = \{ stroke: nStroke, strokeWidth: vsw,/);
  });

  it("B740: multi-selection shares style editing, toggles on Shift, and draws per-member OBB outlines", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // Shift (or Ctrl/⌘) TOGGLES a member in/out — via hasSelMod, not the old add-only selMods branch.
    expect(src).toMatch(/import \{[^}]*hasSelMod[^}]*\} from "\.\.\/\.\.\/shared\/markup\/selection\.js";/);
    expect(src).toMatch(/if \(hasSelMod\(e\)\) \{\s*\n\s*const mods = \{ toggle: true, add: false \};/);
    // the shared panel opens for a styleable multi-selection even when sel is null (a marquee)
    expect(src).toMatch(/const multiStyleable = multi\.length > 1 && multi\.some/);
    expect(src).toMatch(/const companionSel = \(!!sel &&[^;]*\) \|\| multiStyleable;/);
    // the write helpers fan a patch across the whole selection (els dedup via a host-id Set)
    expect(src).toMatch(/const applyMultiElPatch = /);
    expect(src).toMatch(/const applyMultiMarkupPatch = /);
    expect(src).toMatch(/const applyMultiStyle = \(patch\) => \{ pushHistory\(\); liveMultiStyle\(patch\); \};/);
    // single-element transform grips are suppressed while multi-selecting (no group transform, B740 req 4)
    expect((src.match(/\|\| multi\.length > 1\) return null;/g) || []).length).toBeGreaterThanOrEqual(4);
    // multi outlines are per-member (rotation-aware) and never leak into an export
    expect(src).toMatch(/selectionRingFeet\(o, m\.kind\)/);
    expect(src).toMatch(/<g data-export="skip" pointerEvents="none">/);
  });

  it("B617: linear markup stroke weights scale with zoom (strokeZoom), NOT fixed screen px", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // the pure clamp helper exists and is clamped both ends (floor + relative ceil)
    expect(src).toMatch(/const strokeZoom = \(base, zk\) => Math\.max\(STROKE_ZOOM_FLOOR, Math\.min\(base \* zk, base \* 3\.5\)\);/);
    // the markup layer computes the zoom-scaled width and uses it
    expect(src).toMatch(/const vsw = strokeZoom\(nsw, zk\);/);
  });

  it("B719: a centerline road's pavement edge + curb stripes are drawn TO SCALE (true 6\" curb), not strokeZoom", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // the floor constant exists and curbStrokePx is imported from the pure road-geometry lib
    expect(src).toMatch(/const CURB_STROKE_MIN_PX = 0\.75;/);
    expect(src).toMatch(/import \{[^}]*curbStrokePx[^}]*\} from "\.\/lib\/roadGeometry\.js";/);
    // the road pavement edge (back-of-curb outline) uses the real-world curb width, NOT strokeZoom
    expect(src).toMatch(/key="edge"[^\n]*strokeWidth=\{curbStrokePx\(roadCurbWidth\(el\), ppf, CURB_STROKE_MIN_PX\)\}/);
    // the face-of-curb stripes too
    expect(src).toMatch(/key=\{`curb\$\{i\}`\}[^\n]*strokeWidth=\{curbStrokePx\(roadCurbWidth\(el\), ppf, CURB_STROKE_MIN_PX\)\}/);
    // and the legacy rect road border/stripes are on the same to-scale width (no strokeZoom for roads)
    expect(src).toMatch(/cw = curbStrokePx\(el\.curb \?\? CURB, ppf, CURB_STROKE_MIN_PX\)/);
    expect(src).not.toMatch(/el\.type === "road" \? strokeZoom\(/);
  });

  it("B880: the setback ring scales weight+dash with zoom (B617 sibling) and drops when its inset goes sub-pixel", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // the pure zoom helpers are imported from the dedicated lib
    expect(src).toMatch(/import \{ dashZoom, insetRingVisible \} from "\.\/lib\/lineZoom\.js";/);
    // sub-pixel-inset suppression guards the setback map (kills the garbled double-line on zoom-out)
    expect(src).toMatch(/if \(!insetRingVisible\(Math\.min\(\.\.\.posSb\), view\.ppf\)\) return null;/);
    // the visible dashed ring uses strokeZoom + dashZoom — NOT the old fixed 1.25px / "7 6"
    expect(src).toMatch(/stroke=\{PAL\.setback\} strokeWidth=\{strokeZoom\(1\.25, zk\)\} strokeDasharray=\{dashZoom\("7 6", zk\)\}/);
    expect(src).not.toMatch(/stroke=\{PAL\.setback\} strokeWidth=\{1\.25\} strokeDasharray="7 6"/);
    // the B617-sibling dashes fold through dashZoom too (markup source, easement/deed spines)
    expect(src).toMatch(/da = dashZoom\(dashArray\(m\.dash, sw\), zk\)/);
  });

  it("B755 fix (V268, Bain live-verify 2026-07-18): the BFE-line/cross-section fetch uses a WIDER envelope than the zone/DEM fetch, matching the derivation engine's own search radius", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // the widened pad constant exists and is used to build a second, wider bbox
    expect(src).toMatch(/const BFE_SEARCH_PAD_DEG = 0\.04;/);
    expect(src).toMatch(/const bfeSearchBbox = isFinite\(mnX\) \? floodGeoBbox\(\[\[\[llA\[1\], llA\[0\]\], \[llB\[1\], llB\[0\]\]\]\], BFE_SEARCH_PAD_DEG\) : null;/);
    // the BFE-lines and cross-sections fetches key off the WIDER bbox, not the tight fmBbox
    expect(src).toMatch(/const bfeLinesP = bfeSearchBbox\s*\n\s*\? fetchCached\(VECTOR_SOURCES\.bfeLines, bfeSearchBbox,/);
    expect(src).toMatch(/const crossSectionsP = bfeSearchBbox\s*\n\s*\? fetchCached\(VECTOR_SOURCES\.crossSections, bfeSearchBbox,/);
    // the zone polygon + DEM grid fetches deliberately stay on the tight fmBbox (unchanged)
    expect(src).toMatch(/const floodGeoP = fmBbox\s*\n\s*\? fetchCached\(VECTOR_SOURCES\.fema, fmBbox,/);
    expect(src).toMatch(/const siteGridP = fmBbox\s*\n\s*\? fetchSiteGrid\(/);
  });

  it("B755 fix, round 3 (Bain live-verify 2026-07-18): the 'BFE (1% WSE)' input's auto-value ternary reads the cross-section-derived estimate (derivedXsWsel), which the field omitted entirely even though it's a real, already-priced provider", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // the floodMit props object threads the cross-section estimate through to the panel
    expect(src).toMatch(/derivedXsWsel: fmDerivedXsWsel, \/\/ B755 round 3/);
    // the input's auto-value + label check derivedXsWsel FIRST — same precedence order as
    // the engine's own zoneWaterSurface (cross-section beats BFE-line beats FBCDD DRAFT)
    expect(src).toMatch(/fm\.derivedXsWsel && Number\.isFinite\(fm\.derivedXsWsel\.wselFt\) \? fm\.derivedXsWsel\.wselFt\s*\n\s*: fm\.derivedBfe && Number\.isFinite\(fm\.derivedBfe\.bfeFt\) \? fm\.derivedBfe\.bfeFt/);
    expect(src).toMatch(/fm\.derivedXsWsel && Number\.isFinite\(fm\.derivedXsWsel\.wselFt\) \? wseProvLabel\("xs-wsel"\)/);
  });

  it("B619: selecting an object never recolors it to the app accent (handle-based selection)", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // the neutral blue selection chrome + white handle constants exist (real hexes, not var() tokens)
    expect(src).toMatch(/const SEL_BLUE = "#2563eb";/);
    expect(src).toMatch(/const SEL_HANDLE_FILL = "#ffffff";/);
    // NO canvas object stroke is recolored to PAL.accent on selection anymore
    expect(src).not.toMatch(/isSel \? PAL\.accent : /);
    expect(src).not.toMatch(/isSel \? selStroke : st\.stroke/);
    // the callout border keeps the callout's own color when selected
    expect(src).toMatch(/const border = st\.stroke;/);
  });

  it("B620: inline labels ride the line (auto-flip, own color+halo, non-sticky, exported)", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // the pure placement helper exists and auto-flips the angle into [-90,90] (never upside-down)
    expect(src).toMatch(/function inlineLabelPlaces\(/);
    expect(src).toMatch(/ang = \(\(ang % 180\) \+ 180\) % 180; if \(ang > 90\) ang -= 180;/);
    // per-feature repeat spacing (sewer dense → road sparse)
    expect(src).toMatch(/const INLINE_LABEL_SPACING = \{ line: 150, polyline: 150, easement: 350, road: 700 \};/);
    // the label <text> carries a white halo (paintOrder stroke) and is NOT export-skipped
    expect(src).toMatch(/paintOrder: "stroke", stroke: "#fff", strokeWidth: haloW/);
    expect(src).not.toMatch(/inlineLabelEls[\s\S]{0,400}data-export="skip"/);
    // the inline-label writers are NON-STICKY — never the sticky setSelMarkup/liveMarkup (which push into
    // mkStyle and would bleed the typed text into the next drawn shape)
    expect(src).not.toMatch(/setSelMarkup\(\{ inlineLabel/);
    expect(src).not.toMatch(/liveMarkup\(\{ inlineLabel/);
    // panel fields push ONE undo frame per edit (onFocus), not one per keystroke
    expect(src).toMatch(/onFocus=\{\(\) => pushHistory\(\)\}[\s\S]{0,180}inlineLabel: e\.target\.value/);
    // B935 — the inline label is edited ONLY in the Properties panel now; the on-canvas double-click
    // text editor was removed (double-click always opens Properties), so its handlers must be gone.
    expect(src).not.toMatch(/const commitEditInline\b/);
    expect(src).not.toMatch(/beginEditInline\(/);
    // all three render sites are wired: markup line/polyline, easement (centerline/ring), road centerline
    expect(src).toMatch(/inlineLabelEls\(mkPts\(m\), m\.inlineLabel/);
    expect(src).toMatch(/inlineLabelEls\(easePathFeet, m\.inlineLabel/);
    expect(src).toMatch(/inlineLabelEls\(roadDenseCenterline\(el, settings\), el\.inlineLabel/);
  });

  it("B678: inline-label per-feature controls (spacing/size/halo) + screen-space self-thinning", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // the renderer takes per-feature style opts and a base font size that DEFAULTS to the old 11
    expect(src).toMatch(/function inlineLabelEls\(ptsFeet, text, color, spacingFt, ppf, f2p, keyPrefix, opts\)/);
    expect(src).toMatch(/opts\.size[\s\S]{0,40}\?\s*opts\.size\s*:\s*11/);
    // background halo is a toggle (on by default) — the paint-order stroke is conditional
    expect(src).toMatch(/const halo = !\(opts && opts\.halo === false\)/);
    expect(src).toMatch(/halo \? \{ paintOrder: "stroke", stroke: "#fff", strokeWidth: haloW \} : null/);
    // screen-space self-thinning is an ANTI-OVERLAP floor (just above the label's own width), NOT a big
    // fixed floor that would dominate every zoom and make the spacing control inert (B682: 0.7, was 0.9)
    expect(src).toMatch(/const minGapPx = label\.length \* fs \* 0\.85;/);
    expect(src).not.toMatch(/const minGapPx = Math\.max\(150,/);
    expect(src).toMatch(/const effSpacingFt = Math\.max\([\s\S]{0,80}minGapPx \/ Math\.max\(ppf/);
    // every render site threads the feature's own spacing override + { size, halo } opts (the road also
    // carries the B935 `insetFt` for "Inside" placement, so don't require the object to close right after)
    expect(src).toMatch(/m\.labelSpacing \|\| INLINE_LABEL_SPACING\.line[\s\S]{0,80}\{ size: m\.labelSize, halo: m\.labelHalo \}/);
    expect(src).toMatch(/el\.labelSpacing \|\| INLINE_LABEL_SPACING\.road[\s\S]{0,80}\{ size: el\.labelSize, halo: el\.labelHalo/);
    // the panel controls exist and their writers stay NON-STICKY (direct setMarkups / setSelEl, never mkStyle)
    expect(src).toMatch(/const inlineLabelControls = \(feat, typeKey, write\) =>/);
    expect(src).not.toMatch(/setSelMarkup\(\{ labelSpacing/);
    expect(src).not.toMatch(/setSelMarkup\(\{ labelSize/);
  });

  it("B682: label spacing has a LIVE slider (coalesced to one undo frame) beside the number box", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // a range input driving labelSpacing live, closing its undo session on release/blur
    expect(src).toMatch(/<input type="range"[\s\S]{0,220}write\(\{ labelSpacing: \+e\.target\.value \}, \{ live: true \}\)/);
    expect(src).toMatch(/onPointerUp=\{\(e\) => write\(\{ labelSpacing: \+e\.target\.value \}, \{ live: false \}\)\}/);
    // the coalescing writer pushes history only when the live session opens, and stays NON-STICKY
    expect(src).toMatch(/const coalesceLabelWrite = \(key, applyFn\) =>/);
    expect(src).toMatch(/if \(opts\.live\) \{ if \(labelSessionRef\.current !== key\) \{ pushHistory\(\); labelSessionRef\.current = key; \}/);
    expect(src).toMatch(/inlineLabelControls\(selMarkup, selMarkup\.kind, coalesceLabelWrite\(selMarkup\.id/);
    expect(src).toMatch(/inlineLabelControls\(selEl, "road", coalesceLabelWrite\(selEl\.id/);
  });

  it("B750/B935: single-click selects only; a double-tap opens Properties (only a callout still edits its text)", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // isDoubleTap now also carries whether the feature was ALREADY selected at the FIRST press (wasSel);
    // it reconstructs the browser's own double-click test (pointer capture eats the DOM dblclick) and
    // exposes the first-press selection via dblWasSelRef when the second tap matches.
    expect(src).toMatch(/const isDoubleTap = \(e, id, wasSel\) => \{/);
    expect(src).toMatch(/const near = Math\.abs\(e\.clientX - p\.x\) <= DBLTAP_PX/);
    expect(src).toMatch(/dblWasSelRef\.current = !!p\.wasSel;/);
    // callout: already-selected → edit text in place; otherwise open Properties (a callout IS a text box)
    expect(src).toMatch(/if \(part === "box" && isDoubleTap\(e, id, [\s\S]{0,90}if \(dblWasSelRef\.current\) beginEditCallout\(id\);[\s\S]{0,90}setPropsFor\(\{ kind: "callout", id \}\)/);
    // B935 — a markup (line/polyline/easement) double-tap ALWAYS opens Properties, never an inline editor
    expect(src).toMatch(/if \(m && !m\.locked && isDoubleTap\(e, id, sel\?\.kind === "markup" && sel\.id === id\)\) \{[\s\S]{0,120}setPropsFor\(\{ kind: "markup", id \}\)/);
    // B935 — an element (centerline road) double-tap ALWAYS opens Properties, never an inline editor
    expect(src).toMatch(/if \(!el\.groupId && !el\.locked && isDoubleTap\(e, id, sel\?\.kind === "el" && sel\.id === id\)\) \{[\s\S]{0,120}setPropsFor\(\{ kind: "el", id \}\)/);
    // NEW-1 supersedes the B656 stacking: on DESKTOP the inspector is the docked "properties" panel
    // (leftPanel === "properties"), never a companion riding above another panel; NARROW keeps the ✎
    // pill (narrowProps) + companion overlay. propsMatches stays for the double-click explicit-open path.
    expect(src).toMatch(/const propsMatches = propsFor === "multi"/);
    expect(src).toMatch(/const companionOpen = companionSel && \(narrow \? \(!!leftPanel \|\| narrowProps\) : leftPanel === "properties"\)/);
    // onElDouble AND onMarkupDouble (the native/raw-dblclick fallbacks) now OPEN PROPERTIES; the
    // type/actions menu moved off double-click and stays on right-click via onElContext.
    expect(src).toMatch(/const onElDouble = \(e, id\) => \{[\s\S]*?setPropsFor\(\{ kind: "el", id \}\);\s*\n\s*\};/);
    expect(src).toMatch(/const onMarkupDouble = \(e, id\) => \{[\s\S]*?setPropsFor\(\{ kind: "markup", id \}\);\s*\n\s*\};/);
    expect(src).toMatch(/const onElContext = \(e, id\) => \{[\s\S]*?setTypeMenu\(\{ id, x: e\.clientX, y: e\.clientY \}\);/);
  });

  it("NEW-1: single-occupancy left dock — inspector TAKES OVER the dock when it opens, never stacks", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // the takeover layout effect is gated on the inspector OPENING (propsMatches — B750's explicit open,
    // NOT a plain click), docks "properties", and memoizes what it replaced
    expect(src).toMatch(/if \(shouldInspectorTakeDock\(\{ inspectorOpen: propsMatches, narrow, alreadyDocked: leftPanelRef\.current === "properties" \}\)\) \{/);
    expect(src).toMatch(/setDockMemo\(\{ restore: leftPanelRef\.current \}\);/);
    // closing the inspector hands the dock back (or closes it) via the pure resolver
    expect(src).toMatch(/setLeftPanel\(\(p\) => dockAfterRelinquish\(\{ leftPanel: p, restore: memo\.restore \}\)\); setDockMemo\(null\);/);
    // the pure decision helpers live in the shared floating-panel module (host owns the state/wiring)
    expect(src).toMatch(/import \{[^}]*shouldInspectorTakeDock, dockAfterRelinquish[^}]*\} from "\.\.\/\.\.\/shared\/ui\/floatingPanel\.js";/);
    // the 45%-cap "rides above another panel" layout survives ONLY on narrow (never stacks on desktop)
    expect(src).toMatch(/flex: \(narrow && leftPanel && !propsTab\) \? "0 1 auto" : "1 1 auto"/);
    expect(src).not.toMatch(/flex: \(leftPanel && !propsTab\) \? "0 1 auto"/);
    // a plain single click still SELECTS ONLY on desktop (B750 preserved — the takeover keys off propsMatches)
    expect(src).toMatch(/const companionOpen = companionSel && \(narrow \? \(!!leftPanel \|\| narrowProps\) : leftPanel === "properties"\)/);
    // a deliberate rail choice drops the takeover memo so a later deselect can't yank the panel back
    expect(src).toMatch(/setDockMemo\(null\);\s*\n\s*setLeftPanel\(\(p\) => \(p === tb\.id \? null : tb\.id\)\);/);
  });

  it("B680: callout editor hides the committed box + chrome while editing (no doubling), keeps a typeable min", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // the committed box + selection chrome are hidden while THIS callout's editor is open → only ONE box
    expect(src).toMatch(/editCallout\?\.id !== c\.id && <rect data-testid=\{`callout-box-\$\{c\.id\}`\} x=\{boxRect\.x\}/);
    expect(src).toMatch(/isSel && tool === "select" && editCallout\?\.id !== c\.id/);
    // a screen-px minimum is kept ONLY for typeability — safe now the box is hidden (can't double it).
    // B913 — geometry now comes from calloutLayout (auto-size OR wrap-to-boxW); the 64/30 min is kept
    // for the auto path (a fixed-width box already has an explicit, non-tiny width).
    expect(src).toMatch(/const w = wrapped \? geo\.w : Math\.max\(64, geo\.w\), h = Math\.max\(30, geo\.h\)/);
  });

  it("B681: callout align buttons use the Word-style SVG icon, not cryptic glyphs", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(src).toMatch(/function AlignIcon\(\{ dir \}\)/);
    expect(src).toMatch(/<AlignIcon dir=\{a\} \/>/);
    // the old unicode align glyphs are gone from the align-button map
    expect(src).not.toMatch(/\["left", "⇤", "Align left"\]/);
  });

  it("B567: shared ColorControl fires live on input + Doc Review coalesces it to one undo frame", () => {
    const pp = read("../src/shared/markup/PropertyPanel.jsx");
    expect(pp).toMatch(/onInput=\{\(e\) => onChange\(e\.target\.value, \{ live: true \}\)\}/);
    expect(pp).toMatch(/onChange=\{\(e\) => onChange\(e\.target\.value, \{ live: false \}\)\}/);
    const dr = read("../src/workspaces/doc-review/DocReview.jsx");
    expect(dr).toMatch(/const colorSessionRef = useRef\(null\)/);
    expect(dr).toMatch(/if \(opts\.live\) \{\s*if \(colorSessionRef\.current !== key\) \{ pushHistory\(\); colorSessionRef\.current = key; \}/);
  });

  it("B579: the Stitcher detail popup releases pointer capture on pointercancel (no stuck grab)", () => {
    const src = read("../src/workspaces/doc-review/Stitcher.jsx");
    // onPointerCancel must release capture, matching onPointerUp — not just clear drag state
    expect(src).toMatch(/onPointerCancel=\{\(e\) => \{ detailDrag\.current = null; try \{ e\.currentTarget\.releasePointerCapture\(e\.pointerId\)/);
  });

  it("B579: reviewStore deleteReview clears the local mirror only after a successful cloud delete", () => {
    const src = read("../src/workspaces/doc-review/lib/reviewStore.js");
    // the unconditional pre-delete clearDraft is gone; it now runs only on !error
    expect(src).not.toMatch(/\}\s*catch \(_\) \{\}\s*\n\s*if \(uid\) clearDraft\(uid, id\);/);
    expect(src).toMatch(/if \(!error && uid\) clearDraft\(uid, id\)/);
  });

  it("B579: DocReview warns on a genuine signed-in PDF store failure (not oversize, not logged-out)", () => {
    const src = read("../src/workspaces/doc-review/DocReview.jsx");
    expect(src).toMatch(/if \(!r\.ok && !r\.oversize && \(await cloudReady\(\)\)\)/);
  });

  it("NEW-4: a failed key↔id mapping write rolls the just-saved bytes back (no phantom 'saved')", () => {
    const adapter = read("../server/storage/adapter.js");
    expect(adapter).toMatch(/const bound = await idMap\.bind\(/);
    expect(adapter).toMatch(/if \(bound && bound\.ok === false\)/);
    expect(adapter).toMatch(/backend\.remove\(r\.backendId\)/);
    const complete = read("../functions/api/uploads/[id]/complete.js");
    // the chunked-upload COMPLETE rolls the Drive file back if the mapping doesn't persist
    // (B409 rework moved this guard from the retired /api/files/resumable commit)
    expect(complete).toMatch(/if \(setRes && setRes\.ok === false\)/);
    // NEW-F2: the rollback trashes (recoverable), never permanent-deletes
    expect(complete).toMatch(/client\.trash\(session\.drive_file_id\)/);
    expect(complete).not.toMatch(/client\.del\(session\.drive_file_id\)/);
  });

  it("B735: the export aerial + viewBox share ONE extent (no dev-only guard that blanks a parcels-only site)", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // buildExportSvg AND exportAerialForFrame both crop to exportFeetExtent(frame) — the single
    // source of truth. If a future edit re-adds a dev-only `if (!dev) return null` in the aerial
    // path, a parcels-only site over the live basemap silently exports white again (the confirmed
    // review defect). Guard the shared-helper wiring + the LOUD-FAILURE marker + warn.
    expect(src).toMatch(/const exportFeetExtent = \(frame\) =>/);
    expect(src).toMatch(/const ext = exportFeetExtent\(frame\);/); // exportAerialForFrame reuses it
    expect(src).toMatch(/const fe = exportFeetExtent\(frame\);/);  // buildExportSvg reuses it (no inline dev-only extent)
    expect(src).toMatch(/data-export-aerial/);                     // the dropped-aerial marker survives
    expect(src).toMatch(/aerialDropped/);                          // LOUD-FAILURE signal survives
  });

  it("B839: the export aerial stitches cached tiles (fast) with a dynamic-/export fallback", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // The fast path reuses cached XYZ tiles instead of a slow dynamic /export render, and the live
    // tile layers request CORS so those bytes are canvas-readable and shared with the stitch.
    expect(src).toMatch(/stitchAerialDataUrl/);
    expect(src).toMatch(/pickAerialTileZoom/);
    expect(src).toMatch(/crossOrigin: true/);                      // both live tile layers (backfill + detail)
    expect((src.match(/crossOrigin: true/g) || []).length).toBeGreaterThanOrEqual(2);
    // exportAerialForFrame must be async (it awaits the tile fetches) and both callers await it.
    expect(src).toMatch(/const exportAerialForFrame = async \(frame\)/);
    expect((src.match(/await exportAerialForFrame\(printFrame\)/g) || []).length).toBe(2); // PNG + PDF
  });

  it("B840: the aerial fetch has its own longer budget + retry + alternate-source fallback", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(src).toMatch(/AERIAL_INLINE_TIMEOUT_MS/);               // aerial-specific budget, not the shared 8s
    expect(src).toMatch(/isOverlay \|\| isAerial\) && fallback/);  // aerial retries its data-fallback-href (alt source)
    // fetchAsDataUrl accepts a per-call timeout + retries.
    expect(src).toMatch(/const fetchAsDataUrl = async \(url, \{ timeout = INLINE_TIMEOUT_MS, retries = 0 \}/);
  });

  it("B841: the aerial-drop banner no longer blames the connection (PDF + PNG parity)", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // New copy on BOTH export paths (PDF-PARITY), and the misleading "Check your connection" tail
    // is gone from the aerial banner specifically.
    expect(src).toMatch(/took too long to load, so the PNG was exported without it/);
    expect(src).toMatch(/took too long to load, so the PDF was exported without it/);
    expect(src).not.toMatch(/satellite imagery, so the (?:PDF|PNG) was exported without it\. Check your connection/);
    // Still a red-warning banner (the ⚠ prefix that flips it off the success-green — B341-class).
    expect((src.match(/⚠ The satellite imagery took too long to load/g) || []).length).toBe(2);
  });
});

describe("B36(e)/B843: view-driven map layers guard against stale post-unmount renders", () => {
  // Leaflet needs a DOM, so these layers can't be unit-tested in the node env — a source
  // guard keeps a concurrent merge from silently reverting the fix (same rationale as the
  // guards above). The defect: `if (!map) return` was checked only BEFORE the await, so a
  // fetch that resolved AFTER the layer was toggled off (onRemove nulls `map`) still painted
  // into the detached group + reported "loaded" for an off layer.
  it("B36(e): evidenceLayers overpass + Mapillary have the post-await mount guard, and Mapillary aborts on removal", () => {
    const src = read("../src/workspaces/site-planner/lib/evidenceLayers.js");
    // Overpass rides gisCache.swr (cached) → guarded (not aborted; aborting would poison the cache).
    expect(src).toMatch(/B36e: the layer may have been toggled off \/ the map torn down while the request was/);
    // Mapillary is a direct fetch → AbortController threaded through + aborted on removal + post-await guard.
    expect(src).toMatch(/B36e: abort a slow request the moment the layer is toggled off/);
    expect(src).toMatch(/try \{ feats = await fetchMapillary\(bb, token, sig\); \}/);
    expect(src).toMatch(/if \(sig\.aborted \|\| \(e && e\.name === "AbortError"\)\) return;/);
    expect(src).toMatch(/if \(!map\) return; \/\/ B36e: removed mid-fetch/);
    expect(src).toMatch(/group\.onRemove = function \(m\) \{ if \(ctrl\) ctrl\.abort\(\);/); // the Mapillary onRemove
  });
  it("B843: terrainLayer has the post-await mount guard before paint (same class as overpass)", () => {
    const src = read("../src/workspaces/site-planner/lib/terrainLayers.js");
    expect(src).toMatch(/The layer may have been toggled off \/ the map torn down during the \(heavy/);
    // `if (!map) return` appears at least twice: the top-of-refresh guard AND the post-await guard.
    expect((src.match(/if \(!map\) return;/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("NEW-1 (two-tab cascade false conflicts) — the SitePlanner wiring exists in source", () => {
  it("the sync engine gets a bonded-aware isDirectEdit predicate + the interaction effect stamps gesture/selection targets", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // bonded (attachedTo) elements are derived unless directly touched; everything else stays direct
    expect(src).toMatch(/isDirectEdit: \(kind, id, el\) => kind !== "el" \|\| !el \|\| el\.attachedTo == null \|\| isDirectTouched\(kind, id\)/);
    // drag / sel / multi targets are stamped into directTouchRef…
    expect(src).toMatch(/directTouchRef\.current\.set\(\(kind \|\| "el"\) \+ ":" \+ id, t\)/);
    expect(src).toMatch(/if \(d && typeof d\.id === "string"\) stamp\(d\.kind, d\.id\);/);
    expect(src).toMatch(/if \(sel && typeof sel\.id === "string"\) stamp\(sel\.kind, sel\.id\);/);
    // …both every render AND in the same tick the ops are enqueued (the autosave effect that
    // reconciles is declared above the render-effect stamp — a >10s-idle single-shot edit would
    // otherwise enqueue against aged stamps and mis-tag a directly-edited bonded child as derived)
    expect(src).toMatch(/stampDirectTargets\(\); \/\/ NEW-1 — refresh direct-touch stamps in the SAME tick the ops are enqueued/);
  });

  it("the pending-edit journal is keyed per SESSION (write/read/clear/sweep all pass the tab id)", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(src).toMatch(/const journalSid = journalSessionId\(\)/);
    expect(src).toMatch(/writeJournal\(siteId, journalSid, live\.dirtyEntries\(\), Date\.now\(\)\)/);
    expect(src).toMatch(/clearJournal\(siteId, journalSid\)/);
    // read + sweep share ONE timestamp (a journal must not cross the orphan boundary in between)
    expect(src).toMatch(/readJournal\(siteId, journalSid, journalNow\)/);
    // the refetch consumes own + orphaned journals but NEVER a live sibling's (sweep, not clear-all)
    expect(src).toMatch(/sweepJournals\(siteId, journalSid, journalNow\)/);
    // the old shared-key call shapes must not come back
    expect(src).not.toMatch(/writeJournal\(siteId, live\.dirtyEntries\(\)/);
    expect(src).not.toMatch(/readJournal\(siteId, Date\.now\(\)\)/);
  });
});

describe("B850 (2026-07-15, owner: \"i dont need this large pop up\" then \"shouldn't it just auto-reload\") — the B313 banner shrunk, then suppressed entirely for the Scheduler", () => {
  it("AppHeader's B313 banner is theme-tokened (not hardcoded hex) and dismissible, re-arming on a new conflict episode", () => {
    const src = read("../src/shared/ui/AppHeader.jsx");
    // the old hardcoded-hex banner (a KEY DECISIONS violation) must not come back
    expect(src).not.toMatch(/background: "#3f2d12"/);
    expect(src).not.toMatch(/border: "1px solid #f59e0b"/);
    // theme tokens instead
    expect(src).toMatch(/background: "var\(--surface-raised\)"/);
    expect(src).toMatch(/border: "1px solid var\(--warn-text\)"/);
    // a dismiss control exists and resets on the RISING edge of conflictRisk (a closed banner
    // must reappear for a genuinely new another-tab episode, not stay silenced forever)
    expect(src).toMatch(/multiTabDismissed/);
    expect(src).toMatch(/setMultiTabDismissed\(true\)/);
    expect(src).toMatch(/if \(multiTab\.conflictRisk && !prevConflictRiskRef\.current\) setMultiTabDismissed\(false\);/);
    expect(src).toMatch(/accountActive && multiTab\.conflictRisk && !multiTabDismissed/);
    // the single, accurate "read-only" copy (its only remaining reachers genuinely enforce a lock)
    expect(src).toMatch(/that tab is the active editor; this one is read-only until you switch there or close it/);
    // AUDIT-FIRST round 2 killed the lockEnforced dual-copy prop entirely — dead code once the
    // Scheduler moved to full suppression (multiEditOk) instead of a softened banner variant
    expect(src).not.toMatch(/lockEnforced/);
  });

  it("the Scheduler passes multiEditOk (full suppression) — AUDIT-FIRST confirmed it's genuinely safe: version-guarded saves + a live-refresh poll that blocks (never silently overwrites) a stale write", () => {
    const schedulerSrc = read("../src/workspaces/scheduler/Scheduler.jsx");
    expect(schedulerSrc).toMatch(/\bmultiEditOk\b/);
    expect(schedulerSrc).not.toMatch(/lockEnforced/); // the softened-copy path is gone; suppression replaces it
    // and the claim holds: no editorLock WIRING (the actual import/call a real lock needs) exists
    // anywhere in the scheduler workspace — a bare word match would also trip on this file's own
    // comment explaining the fix, so match the wiring shape, not any mention of the word.
    expect(schedulerSrc).not.toMatch(/from ["'].*editorLock/);
    expect(schedulerSrc).not.toMatch(/editorLockRef/);
    expect(schedulerSrc).not.toMatch(/createEditorLock/);
  });

  it("the embedded scheduler's own live-refresh + version guard actually exist (the safety B850's suppression relies on)", () => {
    const src = read("../public/sequence/index.html");
    // poll every 20s + on focus/reconnect/tab-switch for a newer cloud version
    const checkRemote = src.match(/const check = async \(\) => \{[\s\S]{0,400}/)[0];
    expect(checkRemote).toMatch(/window\.storage\.checkRemote\("hs-v1"\)/);
    expect(checkRemote).toMatch(/document\.hidden\) window\.location\.reload\(\)/); // silent reload when backgrounded + clean
    expect(checkRemote).toMatch(/else setStaleNotice\(true\)/);                     // one-click prompt when visible / unsaved
    // Layer 0: a stale auto-save is BLOCKED, never allowed to silently overwrite a newer cloud rev
    expect(src).toMatch(/cloudRev != null && cloudRev > \(knownRev\[k\] \|\| 0\)\) \{/);
    expect(src).toMatch(/_snapshot\(k, parsed, "stale-block", v\.length\)/); // the blocked copy is recoverable, not lost
    expect(src).toMatch(/window\.dispatchEvent\(new CustomEvent\("planar:stale"/);
  });
});

describe("B869/V352 (2026-07-19 verification handoff): the SITE-BASED suggested FFE chip renders in the Buildability / FFE panel, not only the Mitigation inputs editor", () => {
  it("the Buildability / FFE block (ffeR) reads d.floodMit.suggestFfe and renders a SITE-BASED chip + accept action when no ordinance rule binds", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // Isolate the B824 "Buildability / FFE detail" block (ffeR construction) so this guard can't
    // accidentally pass off the pre-existing mitR copy of the same UI (the original bug).
    const start = src.indexOf("// B824 — Buildability / FFE detail, migrated from the deleted FloodMitigationCard.");
    expect(start).toBeGreaterThan(-1);
    const ffeBlock = src.slice(start, start + 6000);
    // The site-basis suggestion is read from the SAME derivation already computed upstream
    // (suggestedFfe() in lib/buildability.js) — DEDUPE-FIRST, no parallel logic.
    expect(ffeBlock).toMatch(/const sf = d\.floodMit && d\.floodMit\.suggestFfe;/);
    expect(ffeBlock).toMatch(/sf\.applies && sf\.basisKind === "site"/);
    expect(ffeBlock).toMatch(/>SITE-BASED<\/span>/);
    // The accept action writes the real Pad/FFE field with the same provenance tag the
    // Mitigation-group editor uses, so acceptance is consistent everywhere it can happen.
    expect(ffeBlock).toMatch(/d\.floodMit\.onChange\(\{ padFfeFt: Math\.round\(sf\.requiredFfeFt \* 10\) \/ 10, padSrc: "suggested-accepted" \}\)/);
    // An unanchored pond (no usable site basis yet) still says so — never a silent absence.
    expect(ffeBlock).toMatch(/No site-based screening pad yet — \$\{sf\.unknownReason\}/);
  });

  it("suggestedFfe's site tier still only returns a site-based suggestion when NO ordinance rule binds (the pure logic B869 already shipped)", () => {
    const src = read("../src/workspaces/site-planner/lib/buildability.js");
    expect(src).toMatch(/export function siteBasisFfe\(/);
    expect(src).toMatch(/basisKind: "site"/);
  });
});
