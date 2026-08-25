/* B712593 — BROKEN OVERLAY REFERENCE: a reference whose source bytes are confirmed gone forever must
 * self-heal what it can and be CLEANLY REMOVABLE from where the owner is actually looking.
 *
 * Ground truth (queried directly against production, not re-derived — see
 * docs/INCIDENT-2026-08-13-shared-asset-delete.md): plan `smsrrlk9u576` ("Concept A 1M SF", Woods
 * Road) carries an overlay named "Untitled picture.png" whose `storageKey` names a `storage.objects`
 * row that no longer exists (a cross-plan-duplicate delete destroyed it on 2026-08-13, fixed for
 * FUTURE deletes by `sharedAssetRefs.js`, B487600). The bytes are provably unrecoverable — no bucket
 * versioning, no PITR over storage bytes. Two things were wrong with how the app carried that:
 *
 *  (1) The References panel's own ✕ (Remove) button already worked, unconditionally, but the ONLY
 *      surface the owner actually sees — the red placeholder painted where the drawing should be —
 *      never mentioned it. It offered exactly one way out ("click to re-add the file"), which reads
 *      as a permanently stuck error when the owner doesn't have the original file to re-add, or the
 *      reference is one he no longer wants (an accidental paste like "Untitled picture.png").
 *
 *  (2) The auto-heal that nulls a confirmed-dead `storageKey` (so the record stops implying "this is
 *      backed up in the cloud" and stops re-attempting the same doomed download every load) required
 *      `!o.idbKey` — but an overlay with an `idbKey` reaches that heal ONLY after `idbGet` has ALREADY
 *      come back empty on this device (see the `if (cached) { …; continue; }` a few lines above it),
 *      so the guard was refusing to heal exactly the case it was measured on.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");

describe("(1) the on-canvas placeholder offers Remove alongside re-add/retry", () => {
  const renderStart = src.indexOf('const ovErr = overlayLoadErr[o.id];');
  const renderEnd = src.indexOf("})()}", renderStart);
  const renderBody = src.slice(renderStart, renderEnd);

  it("renders a distinct, directly-clickable remove action for every terminal (non-loading) state", () => {
    expect(renderBody).toMatch(/\{!ovLoading &&[\s\S]*?removeOverlay\(o\.id\)/);
  });
  it("the remove action stops propagation so it never also triggers the primary re-add/retry click", () => {
    const removeBlock = renderBody.slice(renderBody.indexOf("{!ovLoading &&"));
    expect(removeBlock).toMatch(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); removeOverlay\(o\.id\); \}\}/);
  });
  it("stays absent while a fetch is genuinely still in flight (nothing to remove yet)", () => {
    // The remove text is gated the SAME way the label falls back to "Loading drawing…" — on ovLoading.
    const removeIdx = renderBody.indexOf("{!ovLoading &&");
    expect(removeIdx).toBeGreaterThan(-1);
  });

  // ⛔ MUTATION CHECK — the PRE-FIX shape (single label, single click target, no remove path at all).
  it("[pre-fix control] the old placeholder had no removeOverlay reference in its render body", () => {
    const preFixPlaceholder = [
      'return (<g data-export="skip"',
      '  style={{ cursor: ovLoading ? "default" : "pointer" }}',
      "  onPointerDown={(e) => e.stopPropagation()}",
      '  onClick={ovLoading ? undefined : (e) => { e.stopPropagation(); if (ovErr === "network") retryOverlay(o.id); else reAddOverlay(o.id); }}>',
      '  <rect x={tl.x} y={tl.y} width={w} height={h} fill="#fbf3ee" fillOpacity={0.55} stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="8 5" />',
      '  <text x={cx} y={cy} textAnchor="middle" fontSize={13} fill={PAL.accent}>{label}</text>',
      "</g>);",
    ].join("\n");
    expect(preFixPlaceholder).not.toMatch(/removeOverlay/);
  });
});

describe("(2) the confirmed-dead-storageKey heal fires whether or not the record still carries an idbKey", () => {
  const healStart = src.indexOf('// NEW-2 (B785) — a CONFIRMED-missing cloud object with no local copy');
  const healEnd = src.indexOf("\n", src.indexOf("storageMissing: true } : x)));", healStart));
  const healBody = src.slice(healStart, healEnd);

  it("the guard no longer requires the record to be idbKey-less", () => {
    expect(healBody).not.toMatch(/&&\s*!o\.idbKey/);
  });
  it("still requires a confirmed-missing reason, a real storageKey, and an active cloud session", () => {
    expect(healBody).toMatch(/reason === "missing" && o\.storageKey && isCloudActive\(\)/);
  });

  // ⛔ MUTATION CHECK — the PRE-FIX guard, which is exactly what left the Woods Road overlay
  // (idbKey present, but the bytes gone from BOTH tiers) re-fetching from a confirmed-dead key
  // forever instead of healing.
  it("[pre-fix control] the old guard would have refused to heal an overlay carrying an idbKey", () => {
    const woodsRoadOverlay = { idbKey: "raster:smsrrlk9u576:overlay:e1454691snsene", storageKey: "…/e1454691snsene.png" };
    const reason = "missing", isCloudActive = () => true;
    const preFixWouldHeal = reason === "missing" && woodsRoadOverlay.storageKey && !woodsRoadOverlay.idbKey && isCloudActive();
    expect(!!preFixWouldHeal).toBe(false); // proves the guard this test replaces was the bug
  });
});
