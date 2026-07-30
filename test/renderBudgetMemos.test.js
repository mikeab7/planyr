/* NEW-2 / NEW-3 / NEW-4 / NEW-5 / NEW-7 — the pure halves of the render-cost + retained-memory
 * pass. Everything here is either a pure library or a source-shape guard over SitePlanner.jsx
 * (vitest is DOM-free, so the React wiring is asserted by reading the source, the house pattern).
 *
 * The rule these guards defend: a memo may only be added where the input set is COMPLETE and
 * enumerable. A missed dependency over flood/detention inputs is a STALE ENGINEERING NUMBER,
 * which is worse than a slow correct one — so the four derivations that were audited and
 * REJECTED for memoisation are asserted to still be un-memoised.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pondContours, detentionStorage } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";
import { coalesceRequest, clearCoalesced, COALESCE_TTL_MS } from "../src/workspaces/site-planner/lib/gisFetch.js";
import { releaseCanvas } from "../src/workspaces/site-planner/lib/releaseCanvas.js";
import { releaseCanvas as reviewReleaseCanvas } from "../src/workspaces/doc-review/lib/releaseCanvas.js";
import { snapshotFootprint, _resetSnapshots } from "../src/workspaces/site-planner/lib/parcelSnapshot.js";

const srcOf = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const src = srcOf("../src/workspaces/site-planner/SitePlanner.jsx");
const header = srcOf("../src/shared/ui/AppHeader.jsx");
const anchored = srcOf("../src/shared/ui/AnchoredMenu.jsx");
const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

describe("NEW-2 — the pointer hot path commits at most once per animation frame", () => {
  it("the cursor readout is scheduled on a frame, never set straight from pointermove", () => {
    expect(src).toContain('scheduleFrameJob("cursor", () => setCursor(fp));');
    expect(src.includes("\n    setCursor(fp);")).toBe(false); // the old unconditional per-move setState
  });

  it("all three vertex drags share ONE frame job — so a frame commits one geometry update, not three", () => {
    for (const setter of ["setParcels", "setEls", "setMeasures"]) {
      expect(src).toContain(`scheduleFrameJob("geom", () => ${setter}(`);
    }
  });

  it("a gesture END flushes synchronously, so nothing downstream reads one move stale", () => {
    // flushSync → React commits → `stateRef` (assigned during render) is refreshed before the
    // release logic and before flushElems() diffs the canvas for the sync engine.
    expect(src).toContain("flushSync(runFrameJobs);");
    const onUp = src.indexOf("const onUp = (e) => {");
    const flushInUp = src.indexOf("flushFrameJobs();", onUp);
    const dRead = src.indexOf("const d = drag.current;", onUp);
    expect(onUp).toBeGreaterThan(-1);
    expect(flushInUp).toBeGreaterThan(onUp);
    expect(flushInUp).toBeLessThan(dRead); // flushed BEFORE any release logic runs
    // …and the one release path that judges the final ring reads the settled state, not the closure.
    expect(src).toContain("const elsNow = stateRef.current.els;");
    // An aborted gesture settles first too, so a pending job can't land after cancelActiveMove.
    const abort = src.indexOf("const abortGesture = (pid = capturePidRef.current) => {");
    expect(src.indexOf("flushFrameJobs();", abort)).toBeLessThan(src.indexOf("cancelActiveMove();", abort));
  });

  /* NEW-4 (2026-07-30) — the guard above named `onUp` and `abortGesture`, and `onTouchStartPinch`
   * — the THIRD gesture-teardown path — was quietly outside it, so it tore `drag.current` down
   * with a coalesced 'geom' job still queued and let it commit a frame later, after the pinch had
   * taken the gesture over. (The stronger claim in the report — that the late job re-applies a
   * vertex a revert had just undone — is not reachable today and is corrected in full at the call
   * site; the ordering invariant is what this defends, and it is what stops that claim becoming
   * true the moment a vertex drag gains a canceler.)
   *
   * Same lesson as NEW-2: a guard that names its subjects protects only what it named. So this one
   * DISCOVERS every teardown instead — whatever function reverts a gesture must settle the pending
   * frame first, and a fourth such path added later is covered on arrival with no edit here. */
  it("EVERY gesture-teardown path settles the pending frame BEFORE it reverts", () => {
    /** Body of `const NAME = (…) => { … }`, by brace matching. */
    const bodyOf = (name) => {
      const at = src.indexOf(`const ${name} = (`);
      if (at < 0) return null;
      const open = src.indexOf("{", src.indexOf("=>", at));
      let depth = 0;
      for (let i = open; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
      }
      return null;
    };
    // Every arrow function in the component that REVERTS a gesture. Found, not listed.
    const names = [...new Set([...src.matchAll(/const (\w+) = \([^)]*\) => \{/g)].map((m) => m[1]))]
      .filter((n) => n !== "cancelActiveMove" && /(?<!\/\/[^\n]*)\bcancelActiveMove\(\);/.test(bodyOf(n) || ""));
    expect(names).toContain("abortGesture");
    expect(names).toContain("onTouchStartPinch");
    for (const n of names) {
      const body = bodyOf(n);
      const flush = body.indexOf("flushFrameJobs();");
      const cancel = body.indexOf("cancelActiveMove();");
      expect(flush, `${n} tears a gesture down without settling the coalesced frame first`).toBeGreaterThan(-1);
      expect(flush, `${n} flushes AFTER the revert — a pending job can land on top of it`).toBeLessThan(cancel);
    }
  });

  it("the frame is cancelled on unmount (no rAF left pointing at a dead component)", () => {
    expect(src).toContain("useEffect(() => () => { if (frameRaf.current) cancelAnimationFrame(frameRaf.current); }, []);");
  });

  it("the idle hover scan is a single pass — no copy, no sort, per pointermove", () => {
    expect(src.match(/\[\.\.\.els\]\.sort\(byZ\)\.reverse\(\)\.find\(/g)).toBe(null); // only the comment naming it survives
    expect(src).toContain("if (!hovered || byZ(x, hovered) >= 0) hovered = x;");
  });
});

describe("NEW-3 — the yield/stormwater derivation is demand-driven, not unconditional", () => {
  it("the whole bundle is built lazily and cached for ONE render only", () => {
    expect(src).toContain("let _drainFacts;");
    expect(src).toContain("const buildDrainFacts = () => {");
    expect(src).toContain("const drainFacts = () => { if (_drainFacts === undefined) _drainFacts = buildDrainFacts(); return _drainFacts; };");
    // `let` inside the render body, so it cannot survive a render — that is what makes this
    // GATING rather than memoising, and therefore structurally unable to hold a stale number.
    expect(src.includes("const _drainFacts = useRef")).toBe(false);
    expect(src.includes("useMemo(() => buildDrainFacts")).toBe(false);
  });

  it("EVERY consumer goes through the accessor — including the two non-obvious ones", () => {
    expect(src).toContain("drainage: drainFacts(),");                  // exportCtx() — the export/print path
    expect(src).toContain("drainFacts()?.floodFailed");                // the pond inspector
    expect(src).toContain("drainage={drainFacts()} parcelOverlaps=");  // the Yield panel
    expect(src).toContain("stormwaterBarSpecs(drainFacts())");         // PDF-PARITY: the printed bars
    // No consumer may reach past the accessor to a bare `drainage` binding.
    expect(src.includes("printMetricPairs, printStormwaterBars, drainage,")).toBe(false);
    expect(src.includes("drainage={drainage}")).toBe(false);
  });
});

describe("NEW-4 — five memos, each with a provably complete input set", () => {
  it("(a) markupsZ is memoised on the raw state, so drawMarkupsZ can actually hit", () => {
    expect(src).toContain("const markupsZ = useMemo(() => [...markups].sort(byZAsc), [markups]);");
  });

  it("(b) drawEls is copied and sorted ONCE, then split at the building band", () => {
    expect(src).toContain("const drawElsZ = useMemo(() => {");
    expect(src).toContain("}, [drawEls]);");
    expect(src.match(/\[\.\.\.drawEls\]\.sort\(byZ\)/g).length).toBe(1); // once, inside the memo
  });

  it("(c) the O(n²) parcel overlap + dissolve memoise on `parcels` alone", () => {
    expect(src).toContain("const parcelOverlapPairs = useMemo(() => overlappingParcelPairs(parcels), [parcels]);");
    expect(src).toContain("const siteSqft = useMemo(() => dissolvedParcelSqft(parcels, parcelOverlapPairs), [parcels, parcelOverlapPairs]);");
  });

  it("(d) the criteria record resolves once per (jurisdiction, overrides) — no call site rebuilds it", () => {
    expect(src).toContain("const critAll = useMemo(() => criteriaFor(critJurKey, { overrides: criteriaOverrides }), [critJurKey, criteriaOverrides]);");
    // exactly ONE criteriaFor call survives in the render body: the memo's own.
    expect(src.match(/criteriaFor\(critJurKey/g).length).toBe(1);
  });

  it("the pond split is read off the ledger pass, not re-derived", () => {
    expect(src).toContain("const pondSplitOf = (e) => (e && pondSplitById.get(e.id)) || pondSplitFor(e);");
    expect(src).toContain("pondSplitById.set(e.id, eSplit);");
  });

  it("the four AUDITED-AND-REJECTED derivations are still un-memoised, deliberately", () => {
    // Each of these has either a non-enumerable input set (detReq closes over a lazily-imported
    // Colorado chunk) or a payoff too small to justify the stale-number risk. A future session
    // that wants one of them owes it its own diff and a numeric regression test.
    for (const name of ["detReq", "pondLedgerEntries", "pondBermScreen", "fmEvalAtWse"]) {
      expect(src.includes(`const ${name} = useMemo(`), `${name} must not be memoised here`).toBe(false);
    }
  });
});

describe("NEW-4(e) — pondContours is memoised like its neighbours in the same file", () => {
  it("returns an identical result for identical inputs (the cache is a real hit, not a re-run)", () => {
    const a = pondContours(rect(220, 140), { depth: 8, freeboard: 1, slope: 3, contourInterval: 1 });
    const b = pondContours(rect(220, 140), { depth: 8, freeboard: 1, slope: 3, contourInterval: 1 });
    expect(b).toBe(a); // same object ⇒ the ~38 clipper runs happened once
  });

  it("every input that changes the answer changes the key", () => {
    const base = { depth: 8, freeboard: 1, slope: 3, contourInterval: 1 };
    const ring = rect(220, 140);
    const first = pondContours(ring, base);
    for (const patch of [{ depth: 10 }, { freeboard: 2 }, { slope: 4 }, { contourInterval: 2 }, { tobElev: 96 }]) {
      expect(pondContours(ring, { ...base, ...patch })).not.toBe(first);
    }
    expect(pondContours(rect(300, 140), base)).not.toBe(first); // a different footprint
  });

  it("a degenerate ring still returns the honest empty result", () => {
    const out = pondContours([{ x: 0, y: 0 }, { x: 1, y: 1 }], { depth: 8 });
    expect(out.levels).toEqual([]);
  });

  it("detentionStorage's memo has room for a real multi-pond plan (~3 signatures per pond)", () => {
    // 40 ponds × 3 signatures, all still resolvable — the old ceiling of 32 thrashed at ten.
    const rings = Array.from({ length: 40 }, (_, i) => rect(200 + i, 120));
    const first = rings.map((r) => detentionStorage(r, 8, 1, 3));
    rings.forEach((r, i) => expect(detentionStorage(r, 8, 1, 3)).toBe(first[i]));
  });
});

describe("NEW-5 — releasing a canvas backing store", () => {
  const fakeCanvas = () => ({ width: 4096, height: 4096 });

  it("zeroes both dimensions (the standard ask for the pixel buffer back)", () => {
    const c = fakeCanvas();
    releaseCanvas(c);
    expect(c.width).toBe(0);
    expect(c.height).toBe(0);
  });

  it("is a no-op on nullish input and never throws on a hostile object", () => {
    expect(() => releaseCanvas(null)).not.toThrow();
    expect(() => releaseCanvas(undefined)).not.toThrow();
    const frozen = Object.freeze({ width: 10, height: 10 });
    expect(() => releaseCanvas(frozen)).not.toThrow();
  });

  it("the Review workspace's copy is behaviourally identical (they are deliberately duplicated)", () => {
    const c = fakeCanvas();
    reviewReleaseCanvas(c);
    expect(c).toEqual({ width: 0, height: 0 });
    // …and the duplication is intentional, so the two bodies must not drift.
    const body = (s) => s.slice(s.indexOf("export function releaseCanvas"));
    expect(body(srcOf("../src/workspaces/doc-review/lib/releaseCanvas.js")))
      .toBe(body(srcOf("../src/workspaces/site-planner/lib/releaseCanvas.js")));
  });

  it("every release site fires AFTER the last read of the pixels, never before", () => {
    // The safety rule in one assertion per file: the release must not precede the call that
    // takes the pixels out (toDataURL / toBlob / getImageData / the copying drawImage).
    const cases = [
      ["../src/workspaces/site-planner/lib/mitigationHeatmap.js", 'canvas.toDataURL("image/png")'],
      ["../src/workspaces/site-planner/lib/image.js", 'canvas.toDataURL("image/jpeg", 0.85)'],
      ["../src/workspaces/site-planner/lib/dxf/dxfOverlay.js", 'canvas.toDataURL("image/png")'],
    ];
    for (const [file, read] of cases) {
      const s = srcOf(file);
      expect(s.indexOf(read), file).toBeGreaterThan(-1);
      expect(s.indexOf("releaseCanvas(canvas)"), file).toBeGreaterThan(s.indexOf(read));
    }
  });

  it("the OCR raster is released by its real OWNER, not by the module that rendered it", () => {
    // renderPageToOcrCanvas HANDS the canvas out, so it must not release it; the runner that
    // finishes with it does, in a finally so a recognizer failure can't leak the buffer.
    const pdf = srcOf("../src/workspaces/doc-review/lib/pdf.js");
    const ocrFn = pdf.slice(pdf.indexOf("export async function renderPageToOcrCanvas"));
    expect(ocrFn.includes("releaseCanvas")).toBe(false);
    expect(srcOf("../src/workspaces/doc-review/lib/ocr.js")).toContain("finally { releaseCanvas(ocrCanvas); }");
  });
});

describe("NEW-6 — the Map view's Leaflet map is capped like the planner's", () => {
  const finder = srcOf("../src/workspaces/site-planner/MapFinder.jsx");

  it("both tile layers get an explicit ceiling", () => {
    expect(finder.match(/boundTileCache\(layer, \(\) => tileCacheLimit\(\{/g).length).toBe(2);
    expect(finder).toContain("imageryCapRef.current = detachCap;");
    expect(finder).toContain("labelsCapRef.current = detachCap;");
  });

  it("hiding the map sheds tiles and releases the duplicate raster overlays", () => {
    expect(finder).toContain("capTileCache(layer, HIDDEN_TILE_CAP)");
    expect(finder).toContain("releaseLayer(map, layer)");
    expect(finder).toContain("delete overlayRefs.current[key];");
  });

  it("the 45s overlay re-probe does not run for a hidden map", () => {
    expect(finder).toContain("if (!visible) return undefined;");
    expect(finder).toContain("}, [overlays, visible]);");
  });

  it("nothing here downgrades what is DRAWN — retina is untouched", () => {
    expect(finder).toContain("detectRetina: true"); // the owner has ruled out any retina downgrade
    expect(finder.includes("detectRetina: false")).toBe(false);
  });
});

describe("NEW-7(a) — the request-coalescing map expires instead of growing forever", () => {
  beforeEach(() => clearCoalesced());

  it("a pan that mints a unique key per view does not accumulate entries", async () => {
    let t = 0;
    const now = () => t;
    // 500 distinct bboxes, each 100 ms apart: every entry is long past its 5 s window by the end.
    for (let i = 0; i < 500; i++) {
      t += 100;
      await coalesceRequest(`gis:bbox-${i}`, () => ({ i }), { now });
    }
    // The very first key must be gone (expired AND well past the cap).
    t += 1;
    let calls = 0;
    await coalesceRequest("gis:bbox-0", () => { calls++; return { i: 0 }; }, { now });
    expect(calls).toBe(1); // re-fetched ⇒ the stale entry was swept, not retained
  });

  it("the coalescing window itself still works — that behaviour is unchanged", async () => {
    let t = 1000, calls = 0;
    const now = () => t;
    const fn = () => { calls++; return "v"; };
    await coalesceRequest("gis:same", fn, { now });
    t += COALESCE_TTL_MS - 1;
    expect(await coalesceRequest("gis:same", fn, { now })).toBe("v");
    expect(calls).toBe(1);              // inside the window → reused
    t += 2;
    await coalesceRequest("gis:same", fn, { now });
    expect(calls).toBe(2);              // past the window → refetched
  });
});

describe("NEW-7(b) — the L1 GIS cache is bounded", () => {
  const store = () => {
    const m = new Map();
    return {
      get length() { return m.size; },
      key: (i) => [...m.keys()][i],
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, v),
      removeItem: (k) => m.delete(k),
    };
  };

  it("an OVERSIZE payload — the one localStorage can never evict — no longer lives forever", () => {
    // >maxEntryBytes never enters the store, so it never appears in ourKeys(), so evictOldest
    // could never reach it. These are the biggest objects in the app; L1 now caps them.
    const c = createGisCache({ store: store(), now: () => 1, maxEntryBytes: 32, maxMemEntries: 4 });
    for (let i = 0; i < 10; i++) c.write(`bbox-${i}`, { big: "x".repeat(200) });
    expect(c.read("bbox-0")).toBe(null);   // evicted from L1, and it was never in the store
    expect(c.read("bbox-9")).not.toBe(null);
  });

  it("evicts the LEAST RECENTLY USED, not merely the oldest write", () => {
    const c = createGisCache({ store: null, now: () => 1, maxMemEntries: 3 });
    c.write("a", 1); c.write("b", 2); c.write("c", 3);
    c.read("a");        // touch → a is now the most recent
    c.write("d", 4);    // over the cap → b (least recently used) goes
    expect(c.read("a")).not.toBe(null);
    expect(c.read("b")).toBe(null);
    expect(c.read("c")).not.toBe(null);
    expect(c.read("d")).not.toBe(null);
  });

  it("a miss is only ever a re-fetch — the durable tier still answers", () => {
    const s = store();
    const c = createGisCache({ store: s, now: () => 1, maxMemEntries: 1 });
    c.write("keep", { v: 1 });
    c.write("other", { v: 2 });   // pushes "keep" out of L1
    expect(c.read("keep")).toMatchObject({ data: { v: 1 } }); // rehydrated from localStorage
  });
});

describe("NEW-7 — parcel snapshots are INSTRUMENTED, not capped blind", () => {
  beforeEach(() => _resetSnapshots());

  it("reports nothing held when nothing is loaded", () => {
    expect(snapshotFootprint()).toEqual({ counties: [], totalFeatures: 0, totalBytes: 0 });
  });

  it("is deliberately read-only — it must not evict anything", () => {
    const s = srcOf("../src/workspaces/site-planner/lib/parcelSnapshot.js");
    const fn = s.slice(s.indexOf("export function snapshotFootprint"), s.indexOf("// Test/teardown helper"));
    expect(fn.includes("loaded.delete")).toBe(false);
    expect(fn.includes("loaded.clear")).toBe(false);
    // and reachable from a real signed-in session, which is the only place the number exists
    expect(s).toContain("window.__planyrSnapshotFootprint = snapshotFootprint;");
  });
});

describe("NEW-1 — F goes to REAL fullscreen, and the header follows the document", () => {
  it("the request targets the document ROOT, never a subtree", () => {
    // Fullscreening a subtree hides every position:fixed overlay outside it — the exit button included.
    expect(header).toContain("const el = typeof document !== \"undefined\" ? document.documentElement : null;");
    expect(header).toContain("const req = el && (el.requestFullscreen || el.webkitRequestFullscreen);");
  });

  it("a REFUSED or unsupported request falls back to hiding the chrome, never to doing nothing", () => {
    expect(header).toContain('if (!req) return Promise.reject(new Error("fullscreen-unsupported"));');
    expect(header).toContain("requestFs().catch(() => { nativeFsRef.current = false; setFullscreen(true); });");
  });

  it("the header state is DERIVED from the document's real fullscreen state", () => {
    expect(header).toContain('document.addEventListener("fullscreenchange", onChange);');
    expect(header).toContain('document.addEventListener("webkitfullscreenchange", onChange);');
    expect(header).toContain("nativeFsRef.current = true; setFullscreen(true);");
    expect(header).toContain("} else if (nativeFsRef.current) { nativeFsRef.current = false; setFullscreen(false); }");
    // Every mounted workspace header hears this document-level event, so it takes the SAME
    // keep-alive gate the shortcut does — else each hidden header collapses and renders its own
    // floating exit button (ui-audit/verify-new1-fullscreen.mjs found two stacked).
    const onChange = header.indexOf("const onChange = () => {");
    expect(header.indexOf("if (!headerOnScreen()) return;", onChange)).toBeGreaterThan(onChange);
    // entering never sets the state directly — one owner, so it can't race the event that reports it
    expect(header.includes("requestFs().then(() => setFullscreen(true))")).toBe(false);
  });

  it("Esc is not fought: the browser consumes it in real fullscreen, and fullscreenchange restores the header", () => {
    expect(header).toContain('if (e.key === "Escape" && !nativeFsRef.current) setFullscreen(false);');
    expect(header.includes('if (e.key === "Escape") setFullscreen(false);')).toBe(false);
  });

  it("the exit button exits the BROWSER's fullscreen, not just the chrome-hide", () => {
    expect(header).toContain("const ex = document.exitFullscreen || document.webkitExitFullscreen;");
    expect(header).toContain("onClick={leaveFullscreen}");
    expect(header).toContain("if (nativeFsRef.current) { exitFs(); return; }");
  });

  it("the keep-alive gate that stops a hidden workspace stealing the shortcut is intact", () => {
    // NEW-1 (2026-07-30) — the gate is UNCHANGED in purpose and STRONGER in reach: it used to
    // carry a `!fullscreenRef.current` exception (because the collapsed header rendered only a
    // fixed button and `offsetParent` is null for fixed elements). The header is position:fixed
    // for the whole fullscreen session now, so that exception would have swallowed `f` and left
    // no way back out. The probe is rect-based instead, and applies unconditionally.
    const keydown = header.indexOf("const handle = (e) => {");
    expect(keydown).toBeGreaterThan(-1);
    expect(header.indexOf("if (!headerOnScreen()) return;", keydown)).toBeGreaterThan(keydown);
    expect(header.includes("!fullscreenRef.current && headerRef.current && headerRef.current.offsetParent === null")).toBe(false);
  });

  it("the visibility probe reads CLIENT RECTS, because offsetParent cannot see a fixed header", () => {
    // The whole reason the exception above could be dropped. `display:none` ⇒ no boxes at all;
    // a fixed header parked at translateY(-100%) still has one. `offsetParent` reports null for
    // BOTH, so reverting this probe silently disables every gate that depends on it.
    expect(header).toContain("const headerOnScreen = () => !!(headerRef.current && headerRef.current.getClientRects().length);");
  });
});

/* NEW-1 (2026-07-30) — fullscreen is a MODE, not a chrome-hide, so it must not be a dead end:
 * you have to be able to change plan or workspace without leaving it. The header slides in from
 * the top edge instead of being unmounted. These guard the shape of that; the behaviour itself is
 * driven end-to-end in ui-audit/verify-new1-fullscreen.mjs. */
describe("NEW-1 — the fullscreen header slides in at the top edge instead of vanishing", () => {
  it("the early return that DELETED the header in fullscreen is gone", () => {
    // The dead end itself: one `if (fullscreen) return <button/>` replaced the breadcrumb, the
    // plan switcher and the module tabs with a single floating control.
    expect(header.includes("  if (fullscreen) {\n    return (\n      <button")).toBe(false);
    // …and the header is now out of FLOW rather than out of the DOM, so the canvas still owns the
    // whole viewport while you work.
    expect(header).toContain('position: "fixed", top: 0, left: 0, right: 0, zIndex: 9998,');
    expect(header).toContain('transform: fsReveal ? "translateY(0)" : "translateY(-100%)"');
  });

  it("a hidden header cannot steal the canvas's clicks, transform or no transform", () => {
    expect(header).toContain('pointerEvents: fsReveal ? "auto" : "none"');
  });

  it("it arms on REACHING the top edge, after an intent delay — not on being in the upper region", () => {
    expect(header).toContain("if (e.clientY > FS_EDGE_PX) { clearT(); return; }");
    expect(header).toContain("timer = setTimeout(() => { timer = 0; if (headerOnScreen()) setFsReveal(true); }, FS_ARM_MS);");
    // The edge band must stay a genuine EDGE — widen it into a "region" and the chrome starts
    // ambushing anyone reaching for the top row of the workspace toolbar.
    expect(Number(header.match(/const FS_EDGE_PX = (\d+);/)[1])).toBeLessThanOrEqual(8);
    expect(Number(header.match(/const FS_ARM_MS = (\d+);/)[1])).toBeGreaterThanOrEqual(120);
  });

  it("it never hides while you are reaching for what it revealed", () => {
    // Three holds, and they are re-checked when the timer FIRES, not only when it is set — so
    // opening a menu during the grace period cancels the hide rather than racing it.
    expect(header).toContain(`if (document.querySelector('[data-menu-owner="app-header"]')) return true;`);
    expect(header).toContain("return el.contains(document.activeElement);");
    expect(header).toContain("if (e.clientY <= r.bottom + FS_HOLD_PX || holdOpen()) { clearT(); return; }");
    expect(header).toContain("timer = setTimeout(() => { timer = 0; if (!holdOpen()) setFsReveal(false); }, FS_HIDE_MS);");
    // The portal stamp that makes the first hold possible — AnchoredMenu leaves the header's tree.
    expect(anchored).toContain(`anchorRef?.current?.closest?.("[data-menu-scope]")?.getAttribute("data-menu-scope")`);
    expect(anchored).toContain("data-menu-owner={ownerScope}");
    expect(header).toContain('data-menu-scope="app-header"');
  });

  it("the exit button rides the same transform, so it needs no measurement and cannot desync", () => {
    expect(header).toContain('position: "absolute", top: "100%", right: 12, marginTop: 10,');
    expect(header).toContain('pointerEvents: "auto",'); // beats the header's own `none` while parked
    expect(header).toContain('data-testid="exit-fullscreen"');
  });

  it("switching workspace hands the mode over — the incoming header adopts, the outgoing relinquishes", () => {
    // The case the reveal creates: every workspace owns its own header, and the incoming one was
    // display:none when `f` was pressed, so it never heard the fullscreenchange.
    expect(header).toContain("const ro = new ResizeObserver(() => {");
    expect(header).toContain("if (fullscreenRef.current) { nativeFsRef.current = false; setFullscreen(false); } // relinquish on the way out");
    expect(header).toContain("if (real !== fullscreenRef.current && (real || nativeFsRef.current)) { nativeFsRef.current = real; setFullscreen(real); }");
  });
});
