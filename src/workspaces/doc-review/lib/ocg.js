/* PDF optional-content ("layer") helpers for the Document Review viewer (B490) — pure, NO pdf.js
 * import, so they unit-test in the node env (test/**). A construction PDF can carry named optional-
 * content groups (Electrical, Plumbing, Grading, …); the viewer lists them and toggles visibility.
 *
 * pdf.js v6 exposes them on the OptionalContentConfig from `pdf.getOptionalContentConfig()`:
 *   • it is ITERABLE (there is NO getGroups() in v6), yielding [id, group] pairs — `id` is a
 *     per-load Ref string (opaque, NOT stable across reopens), `group` has { name, visible, … };
 *   • `config.setVisibility(id, on)` mutates it in place (a radio-button group flips its siblings
 *     off), and `config.getGroup(id)` reads back the live visibility.
 * These helpers touch only that shape, so a test can pass a plain hand-rolled iterable. */

/* Flatten a config's groups into the Layers-panel row model: [{ id, name, visible }]. Flat list in
 * iterator order for v1 (a nested /Order sub-tree is a later refinement). Returns [] when the doc has
 * no optional content — the common case — so the caller shows no Layers control at all. */
export function ocgLayerList(config) {
  if (!config || typeof config[Symbol.iterator] !== "function") return [];
  const rows = [];
  let n = 0;
  for (const entry of config) {
    if (!entry) continue;
    const [id, group] = entry;
    n += 1;
    const nm = group && typeof group.name === "string" ? group.name.trim() : "";
    rows.push({ id, name: nm || `Layer ${n}`, visible: !!(group && group.visible) });
  }
  return rows;
}

/* After a toggle, re-read visibility for EVERY row from the (now-mutated) config — setVisibility on a
 * radio-button group turns its siblings OFF, so flipping just the toggled row would misreport them.
 * Keeps id/name; refreshes `visible` from config.getGroup(id).visible. */
export function deriveLayerVisibility(config, rows) {
  if (!config || typeof config.getGroup !== "function" || !Array.isArray(rows)) return rows || [];
  return rows.map((r) => {
    const g = config.getGroup(r.id);
    return { ...r, visible: !!(g && g.visible) };
  });
}
