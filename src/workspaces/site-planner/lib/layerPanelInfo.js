/* Pure helpers for the Layers-panel row rendering (B760 / B761).
 *
 * These live OUT of the LayerPanel component so they can be unit-tested in a plain
 * node env: LayerPanel.jsx pulls in leaflet/esri (via layers.js), which can't load
 * without a browser, so the component itself isn't node-importable. The content
 * assembly + merged-status logic below are pure string/precedence math — no React,
 * no DOM — and drive what the per-row ⓘ shows and how the merged City/ETJ row's
 * single status dot is derived.
 */

/* Build the per-row ⓘ popover content (B760): the plain-language sublabel, the source,
 * the data vintage + refreshed-age (folded into one line), the row note/caveats, and —
 * only where a boundary is a real trap (via `cfg.infoCaveat`, e.g. MUD/water districts) —
 * the has-jurisdiction caveat that used to be a group paragraph. ALL of this used to render
 * as persistent text under the row; now it's behind the ⓘ so the row stays one line.
 * `tone: "warn"` marks a caveat / a stale-refresh stamp (RowInfo renders it with the
 * --warn-text token). Returns [{ text, tone? }]; empty when a row has nothing to say. */
export function rowInfoSections(cfg = {}, { vintage, age, ls } = {}) {
  const out = [];
  if (cfg.sublabel) out.push({ text: cfg.sublabel });
  if (cfg.source) out.push({ text: `Source: ${cfg.source}` });
  const refreshed = age && ls && (ls.state === "loaded" || ls.state === "empty")
    ? ` · refreshed ${age}${ls.stale ? " (updating…)" : ""}` : "";
  out.push({ text: `As of: ${vintage || "vintage unknown"}${refreshed}`, tone: ls && ls.stale ? "warn" : undefined });
  if (cfg.note) out.push({ text: cfg.note });
  if (cfg.infoCaveat) out.push({ text: cfg.infoCaveat, tone: "warn" });
  return out;
}

/* Fold the two underlying layers' live statuses into ONE dot for the merged
 * City-limits-&-ETJ row (B761). Precedence: loading > failed > loaded > empty > none.
 * Returns the winning status object (so its `msg` is carried) or null when neither is
 * on. Pure — the panel maps the returned state to its STATUS color/label. */
export function combineLayerStatus(...list) {
  const states = list.filter(Boolean);
  if (!states.length) return null;
  const pick = (s) => states.find((x) => x.state === s);
  // "slow" (NEW-3/B790) ranks just under "failed": a stalled sublayer is more actionable than a
  // loaded one, but a genuinely-failed sublayer still wins the combined dot.
  return pick("loading") || pick("failed") || pick("slow") || pick("loaded") || pick("empty") || states[0] || null;
}
