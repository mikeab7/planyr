/* NEW-1 (amendment to B2288560) — the parcel-source banner is bottom-centre and dismissible.
 * Browser half (real Leaflet, real timers, position + dismiss + re-enter): e2e/parcel-notice-dismiss.spec.js.
 * This file pins the wiring that spec cannot see on every run and that must not rot: the shared slot, the labelled ✕,
 * the dismissal flag's lifetime (session of the tool, never persisted) and that unrelated messages keep the old slot. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");

describe("parcel-source banner — bottom centre, removable (owner 2026-10-16)", () => {
  it("renders through the shared FloatingNotice slot, not the bottom-left stack", () => {
    expect(src).toMatch(/<FloatingNotice testId="parcel-source-notice"/);
    // the old stack no longer owns it
    expect(src).toMatch(/\(err && !sourceNoticeFloats\) \|\| locateFar/);
  });
  it("the ✕ is labelled Dismiss and at least 28 px", () => {
    const m = src.match(/data-testid="map-status-toast-dismiss"[\s\S]{0,400}/);
    expect(m, "no dismiss control").toBeTruthy();
    expect(m[0]).toMatch(/aria-label="Dismiss"/);
    expect(m[0]).toMatch(/width: 28, height: 28/);
  });
  it("only a parcel-SOURCE notice floats — matched by its exact message, never any `err`", () => {
    expect(src).toMatch(/sourceNoticeRef\.current\.message === err/);
  });
});

describe("dismissal lifetime — the Select-parcels session, never longer, never persisted", () => {
  it("setSourceNotice refuses to raise while dismissed", () => {
    expect(src).toMatch(/if \(sourceNoticeDismissedRef\.current\) return;[^\n]*\n\s*if \(!sourceNoticeStillPlausible/);
  });
  it("the ✕ sets the flag and retracts the banner", () => {
    expect(src).toMatch(/const dismissSourceNotice = \(\) => \{\s*sourceNoticeDismissedRef\.current = true;\s*retractSourceNotice\(\);/);
  });
  it("ending Select parcels (clearDisplays) resets the flag", () => {
    const fn = src.match(/const clearDisplays = \(\) => \{[\s\S]*?\n  \};/)[0];
    expect(fn).toMatch(/sourceNoticeDismissedRef\.current = false/);
  });
  it("the flag is a plain ref — not localStorage / sessionStorage (a reload must show a new warning)", () => {
    const decl = src.match(/const sourceNoticeDismissedRef = useRef\(false\);/);
    expect(decl).toBeTruthy();
    expect(src).not.toMatch(/(local|session)Storage[^\n]*sourceNoticeDismissed/);
  });
});
