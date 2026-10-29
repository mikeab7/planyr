/* cropContainment — the in-page probe for "does the crop's drawing stay inside its box" (B2448816). ONE instrument, used by
 * ui-audit/verify-crop-contained.mjs (sandbox, fake session) and ui-audit/verify-crop-contained-live.mjs (signed in on a deploy). */
// Every control the user must always be able to press: its centre must answer to ITSELF.
export const CROP_CONTROLS = ["crop-mode-rect", "crop-mode-poly", "crop-cancel", "crop-done", "crop-undo", "crop-redo", "crop-reset", "crop-pan-tool", "crop-zoom-out", "crop-zoom-100", "crop-zoom-in", "crop-zoom-fit"];

export const readCropPage = (page) => page.evaluate((CONTROLS) => {
  const canvas = document.querySelector('[data-testid="crop-canvas"]');
  if (!canvas) return { error: "no crop-canvas" };
  const cr = canvas.getBoundingClientRect();
  const TOL = 1;
  // everything the crop DRAWS (the picture layer is the canvas' first child and is clipped by design; svg internals are not boxes)
  const imgLayer = canvas.firstElementChild;
  const drawn = [...canvas.querySelectorAll("div, svg, [data-testid]")].filter((e) => !imgLayer.contains(e) && e !== imgLayer);
  const outside = [];
  for (const e of drawn) {
    if (e.closest("mask, clipPath")) continue;
    if (e instanceof SVGElement && !(e.dataset && e.dataset.testid) && e.tagName !== "svg") continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const slack = e instanceof SVGElement && e.tagName === "line" ? 9 : TOL; // a polygon edge's invisible hit strip is a 14 px stroke
    if (r.left < cr.left - slack || r.top < cr.top - slack || r.right > cr.right + slack || r.bottom > cr.bottom + slack) {
      outside.push({ id: e.dataset && e.dataset.testid || e.tagName.toLowerCase(), l: Math.round(r.left - cr.left), t: Math.round(r.top - cr.top), r: Math.round(r.right - cr.right), b: Math.round(r.bottom - cr.bottom) });
    }
  }
  const ctl = {};
  for (const id of CONTROLS) {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) { ctl[id] = "absent"; continue; }
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    ctl[id] = hit && el.contains(hit) ? "ok" : "BLOCKED:" + (hit ? (hit.dataset.testid || hit.tagName.toLowerCase()) : "none");
  }
  // grips: each must lie wholly inside the canvas and answer its own centre
  const grips = [...canvas.querySelectorAll('[data-testid^="crop-handle-"]')].map((e) => {
    const r = e.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const inset = Math.min(r.left - cr.left, r.top - cr.top, cr.right - r.right, cr.bottom - r.bottom);
    // The floating toolbar is meant to win a press over a grip it happens to sit on (the pill always answers its own clicks; only
    // the FRAMED view is promised clear of it) — so a grip under the pill is correct, a grip under anything else is a defect.
    const underPill = !!hit && !!hit.closest('[data-testid="crop-toolbar"]');
    return { id: e.dataset.testid, inside: inset >= -0.5, inset: Math.round(inset * 10) / 10, hitsSelf: (!!hit && e.contains(hit)) || underPill };
  });
  const move = canvas.querySelector('[data-testid="crop-move"]');
  const zoomTxt = (document.querySelector('[data-testid="crop-zoom-100"]') || {}).textContent || "";
  return { cr: { w: Math.round(cr.width), h: Math.round(cr.height) }, outside, ctl, grips, hasMove: !!move, zoom: parseInt(zoomTxt, 10) || 0,
    polyHint: !!document.querySelector('[data-testid="crop-poly-hint"]') };
}, CROP_CONTROLS);

export const zoomCropIn = async (page, minPct) => {
  for (let i = 0; i < 40; i++) {
    const z = (await readCropPage(page)).zoom;
    if (z >= minPct) return z;
    await page.locator('[data-testid="crop-zoom-in"]').click();
    await page.waitForTimeout(40);
  }
  return (await readCropPage(page)).zoom;
};

