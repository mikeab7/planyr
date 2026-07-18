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
 * on. Pure — the panel maps the returned state to its STATUS color/label. Also reused
 * (variadic) for the N-ary merge-group rows below (B898). */
export function combineLayerStatus(...list) {
  const states = list.filter(Boolean);
  if (!states.length) return null;
  const pick = (s) => states.find((x) => x.state === s);
  // "slow" (NEW-3/B790) ranks just under "failed": a stalled sublayer is more actionable than a
  // loaded one, but a genuinely-failed sublayer still wins the combined dot.
  return pick("loading") || pick("failed") || pick("slow") || pick("loaded") || pick("empty") || states[0] || null;
}

/* ---------------------------------------------------------------------------
 * B898 — Layers-panel GROUP consolidation (Water & sewer / Electric / Fire hydrants).
 *
 * A panel GROUP (e.g. "utilities") lists entries pulled from ALL_LAYERS by `cfg.group`.
 * Some of those entries share a `cfg.mergeGroup` id (an N-ary generalization of the
 * existing pairwise `mergeWith`/`mergeLabel` mechanism used by City limits & ETJ, which
 * is untouched) — those consolidate into ONE panel row driving every member. This is
 * purely a presentation fold: every member keeps its own fetch/URL/kind untouched.
 * ------------------------------------------------------------------------- */

/* Build the ordered list of render "slots" for one group's entries: consecutive
 * `mergeGroup` members fold into a single `{kind:"merge", mergeGroup, members}` slot;
 * everything else is `{kind:"solo", entry}` (a plain [id,cfg] pair — which may itself be
 * a legacy pairwise `mergeWith` primary; the caller's row renderer already handles that).
 * Sorted by each slot's minimum `cfg.order` (ties keep registry order — Array#sort is
 * stable). Pure — `entries` is `[[id,cfg], ...]`, already filtered to one group and with
 * any pairwise mergeWith SECONDARY dropped by the caller (unchanged from before). */
export function buildGroupSlots(entries) {
  const buckets = new Map(); // mergeGroup id -> slot
  const slots = [];
  for (const entry of entries || []) {
    const [, cfg] = entry;
    if (cfg && cfg.mergeGroup) {
      let slot = buckets.get(cfg.mergeGroup);
      if (!slot) { slot = { kind: "merge", mergeGroup: cfg.mergeGroup, members: [] }; buckets.set(cfg.mergeGroup, slot); slots.push(slot); }
      slot.members.push(entry);
    } else {
      slots.push({ kind: "solo", entry });
    }
  }
  const orderOf = (s) => (s.kind === "solo" ? (s.entry[1]?.order ?? 999) : Math.min(...s.members.map(([, c]) => c?.order ?? 999)));
  return slots.slice().sort((a, b) => orderOf(a) - orderOf(b));
}

/* Is a merge slot ON (any member on)? A single predicate the panel uses for the
 * checkbox, the "N on" group-header count, and the opacity display. Pure. */
export function mergeSlotAnyOn(members, overlays) {
  return (members || []).some(([id]) => overlays?.[id]?.on);
}

/* The merged row's opacity control: the max of whichever members are configured, so
 * raising it never silently lowers a member that was already more visible. Pure. */
export function mergeSlotOpacity(members, overlays, fallback = 0.8) {
  const vals = (members || []).map(([id, cfg]) => overlays?.[id]?.opacity ?? cfg?.opacity ?? fallback);
  return vals.length ? Math.max(...vals) : fallback;
}

/* ⓘ provenance content for a merged row (B898) — ONE line per contributing source, in
 * registry order, so a user can tell whose main/territory/detection each feature is from
 * — this is the same "Source:" provenance pattern rowInfoSections uses for a solo row,
 * repeated per member instead of once. `groupNote` (from MERGE_GROUPS[mergeGroup].note)
 * leads the list; any member `infoCaveat`s follow, deduped by text (several members can
 * carry the identical has-jurisdiction caveat). Pure. */
export function mergeGroupInfoSections(members, { groupNote } = {}) {
  const out = [];
  if (groupNote) out.push({ text: groupNote });
  for (const [, cfg] of members || []) {
    if (!cfg) continue;
    const src = cfg.source || cfg.label || "Unknown source";
    out.push({ text: `${cfg.label || src} — Source: ${src}` });
  }
  const caveats = [...new Set((members || []).map(([, cfg]) => cfg?.infoCaveat).filter(Boolean))];
  caveats.forEach((text) => out.push({ text, tone: "warn" }));
  return out;
}
