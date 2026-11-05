/* wallLayerDrive — the shared drivers for a wall's layers in the Docks & walls panel (NEW-1, 2026-11-03).
 *
 *   addWallLayer(page, row, key)         — add ONE layer through the new control: the named button when it IS that layer
 *                                          (its `data-kind` says which), else the ▾ list under the layer's full name.
 *   dragWallLayerEnd(page, host, side, el, end, feet)
 *                                        — shorten a layer THE WAY THE PRODUCT DOES NOW: select it on the map and drag its end
 *                                          handle inward. The view is centred on that end first (a 5-ft Walk is under two pixels
 *                                          tall zoomed out, where a click selects the building), so the page must expose the
 *                                          planner's view hook: open it with `initScripts: [[() => { window.__PLANYR_E2E = true; }]]`.
 *   alongOf(host, side, el)              — a layer's length + centre ALONG its wall, in the host's frame (rotation-proof).
 * Plain Node + Playwright; no assertions of its own (a harness judges). */
export const alongOf = (host, side, k) => {
  const r = (host.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = k.cx - host.cx, dy = k.cy - host.cy, lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const rel = (((k.rot - host.rot) % 360) + 360) % 360, cross = Math.min(Math.abs(rel - 90), Math.abs(rel - 270)) < 45;
  const bx = cross ? k.h : k.w, by = cross ? k.w : k.h, horiz = side === "top" || side === "bottom";
  return { len: horiz ? bx : by, centre: horiz ? lx : ly };
};

export async function addWallLayer(page, row, key, settleMs = 450) {
  await row.getByTestId(`wall-add-${key}`).click();   // every option is its own icon on the row (no ▾)
  await new Promise((r) => setTimeout(r, settleMs));
}

export async function dragWallLayerEnd(page, host, side, el, end, feet) {
  const rot = (host.rot * Math.PI) / 180, horiz = side === "top" || side === "bottom";
  const u = horiz ? { x: Math.cos(rot), y: Math.sin(rot) } : { x: -Math.sin(rot), y: Math.cos(rot) };
  const sgn = end === "plus" ? 1 : -1, len = alongOf(host, side, el).len, PPF = 2.5;
  const hasHook = await page.evaluate(() => !!(window.__plannerView && window.__plannerView.centerOn));
  if (!hasHook) throw new Error("VOID — the planner view hook is missing (open the page with window.__PLANYR_E2E set before load)");
  await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [el.cx + sgn * u.x * len / 2, el.cy + sgn * u.y * len / 2, PPF]);
  await new Promise((r) => setTimeout(r, 300));
  const box = await page.getByTestId("planner-canvas").boundingBox(), c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(c.x - sgn * u.x * 5 * PPF, c.y - sgn * u.y * 5 * PPF);
  const grips = el.type === "road" ? page.locator('[data-handle-layer="1"] circle, [data-handle-layer="1"] rect') : page.locator('rect[data-handle="edge"]');
  await grips.first().waitFor({ timeout: 2500 });
  const pos = await grips.evaluateAll((n) => n.map((g) => { const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  const nearest = pos.map((p) => ({ p, d: Math.hypot(p.x - c.x, p.y - c.y) })).sort((a, b) => a.d - b.d)[0];
  if (nearest.d > 12) throw new Error(`no grip at the ${end} end (nearest ${Math.round(nearest.d)}px)`);
  const to = { x: nearest.p.x - sgn * u.x * feet * PPF, y: nearest.p.y - sgn * u.y * feet * PPF };
  await page.mouse.move(nearest.p.x, nearest.p.y); await page.mouse.down();
  await page.mouse.move((nearest.p.x + to.x) / 2, (nearest.p.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
}
