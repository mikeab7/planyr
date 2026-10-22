/* The Imagery & Layers panel, as a spec drives it (NEW-1, Imagery & Layers redesign).
 *
 * The panel is TWO PANES now: a group list on the left, the selected group's rows on the right, and only one group is
 * showing at a time. A row therefore may not be in the DOM until its group is selected — so a spec never reaches for a
 * checkbox by name directly; it asks for the ROW by its id (`data-testid="layer-row-<id>"`, a registry key, or a merge
 * group's key — `water_sewer`, `counties_cities`, `pipelines`…) and this helper finds the group that holds it.
 *
 * Both hosts stay mounted (the shell hides the inactive one), so every locator is scoped by `data-surface`. */

export const panelSel = (surface = "planner") => `[data-testid="layer-panel"][data-surface="${surface}"]`;

/* The planner's Layers card is collapsed by default: open it through its own chip (a no-op when it is already open). */
export async function openPlannerLayers(page) {
  const expand = page.getByTestId("layers-expand").filter({ visible: true });
  if (await expand.count()) await expand.first().click();
  await page.locator(panelSel("planner")).first().waitFor({ state: "visible", timeout: 15000 });
}

/* The group keys this panel offers, in order (the left pane's tabs, or the phone-width dropdown's options). */
export async function groupKeys(panel) {
  const tabs = panel.locator('[data-testid="layer-group-nav"] button[role="tab"]');
  if (await tabs.count()) return tabs.evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").replace("layer-group-", "")));
  const sel = panel.locator('[data-testid="layer-group-select"]');
  if (await sel.count()) return sel.locator("option").evaluateAll((os) => os.map((o) => o.value));
  return [];
}

export async function selectGroup(panel, key) {
  const tab = panel.getByTestId(`layer-group-${key}`);
  if (await tab.count()) await tab.click();
  else await panel.locator('[data-testid="layer-group-select"]').selectOption(key);
}

/* The ROW for a layer, switching to whichever group holds it. Throws (loudly) when the panel does not offer it here. */
export async function layerRow(page, rowId, { surface = "planner" } = {}) {
  const panel = page.locator(panelSel(surface)).first();
  const row = panel.getByTestId(`layer-row-${rowId}`);
  if (await row.count()) return row;
  for (const key of await groupKeys(panel)) {
    await selectGroup(panel, key);
    if (await row.count()) return row;
  }
  throw new Error(`the Imagery & Layers panel (${surface}) does not offer a "${rowId}" row at this location`);
}

/* Turn a row on / off through its own checkbox (the one the person would click). */
export async function setLayer(page, rowId, on = true, opts = {}) {
  const row = await layerRow(page, rowId, opts);
  const cb = row.locator('input[type="checkbox"]').first();
  if (on) await cb.check({ force: true }); else await cb.uncheck({ force: true });
  return row;
}

/* Open a row's ▾ dropdown (closing any other — one at a time) and return it. */
export async function openRowMenu(page, rowId, opts = {}) {
  const row = await layerRow(page, rowId, opts);
  const menu = row.getByTestId(`layer-row-${rowId}-menu`);
  if (!(await menu.count())) await row.getByTestId(`layer-caret-${rowId}`).click();
  return menu;
}

/* A row's ⓘ text (source, vintage, caveats — and, for FEMA, the verdict): open its ▾, press "About this layer", read it.
 * Nothing in it is visible until that press — which is the point (PANEL-BREVITY rule 6: reachable, not visible). */
export async function readRowInfo(page, rowId, opts = {}) {
  const menu = await openRowMenu(page, rowId, opts);
  const about = menu.getByRole("button", { name: /^About / });
  const info = menu.getByTestId("layer-info-text");
  if (!(await info.count())) await about.click();
  return (await info.textContent()) || "";
}

/* The group with the MOST rows at this location (ties → the first in panel order). Specs that need "a long group" ask for it instead of
 * naming one: which group is longest depends on WHERE the site is (a Houston-area source only lists inside its own service area). */
export async function longestGroup(panel) {
  let best = null, bestN = -1;
  for (const key of await groupKeys(panel)) {
    await selectGroup(panel, key);
    const n = await panel.locator('[data-testid^="layer-row-"]:not([data-testid$="-menu"])').count();
    if (n > bestN) { best = key; bestN = n; }
  }
  return best;
}
