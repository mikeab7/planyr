/* parcelStack — the ONE answer to "this layer returned several rows for one lot; which lot is it?" (NEW-1/2/3, 2026-11-12).
 *
 * Three counties' layers hand back more than one row for a lot, for three different reasons:
 *   · Bartow GA   — a parcel x improvement JOIN: one PARCELID is up to 170 identical-geometry rows.
 *   · Rutherford TN — the same ParcelID twice, a 0.12-ac sliver beside the 74.6-ac lot.
 *   · Chambers TX — co-owners (one shape, Accounts.Sequence 1/2/3) AND two different overlapping shapes at one point.
 * Each layer declares how its rows collapse ONCE, on its map entry in counties.js (`dedupeBy` and friends → `stackRuleForUrl`),
 * and every consumer (id/address search, the point click, the outline layer, the lot key) reads it through this module — there is
 * no second collapse. Pure: no DOM, no Leaflet, no network. */

const leaf = (k) => String(k).replace(/^.*\./, "").toLowerCase();

/** A feature attribute by field name — the exact key, else a case-insensitive one, else (a JOINED layer publishes table-PREFIXED
 *  keys, "ChambersCADWeb.DBO.Accounts.Sequence") the key whose last dotted segment is the wanted field's. A fully-qualified wanted
 *  name only ever matches its exact key (two joined tables can both carry an OBJECTID). undefined when absent. */
export function attrValue(attrs, field) {
  if (!attrs || !field) return undefined;
  if (field in attrs) return attrs[field];
  const want = String(field).toLowerCase();
  const keys = Object.keys(attrs);
  const ci = keys.find((k) => k.toLowerCase() === want);
  if (ci) return attrs[ci];
  if (String(field).includes(".")) return undefined;
  const tail = keys.find((k) => k.includes(".") && leaf(k) === want);
  return tail ? attrs[tail] : undefined;
}

const present = (v) => v !== undefined && v !== null && String(v).trim() !== "";

/** A feature's ring area in square degrees (lon/lat) — enough to rank two rings of one place. Outer rings add, holes subtract. */
export function featureRingArea(feature) {
  const rings = feature && feature.geometry && feature.geometry.rings;
  if (!rings || !rings.length) return 0;
  let total = 0;
  for (const r of rings) {
    let a = 0;
    for (let i = 0; i < r.length; i++) { const j = (i + 1) % r.length; a += r[i][0] * r[j][1] - r[j][0] * r[i][1]; }
    total += -a / 2; // esri outer rings run clockwise (negative signed area) and holes counter-clockwise
  }
  return Math.abs(total);
}

/* the representative of one lot's rows */
function representative(rows, rule) {
  let list = rows;
  if (rule.order) {
    const num = (f) => { const v = Number(attrValue(f.attributes, rule.order)); return Number.isFinite(v) ? v : Infinity; };
    list = rows.map((f, i) => ({ f, i })).sort((a, b) => num(a.f) - num(b.f) || a.i - b.i).map((x) => x.f); // stable: ties keep the server's order
  }
  if (rule.prefer === "largest") {
    let best = list[0], bestA = featureRingArea(best);
    for (let i = 1; i < list.length; i++) { const a = featureRingArea(list[i]); if (a > bestA) { best = list[i]; bestA = a; } }
    return best;
  }
  return list[0];
}

/** What a collapse of the rows of ONE lot is called, for the note: "owners" (the rows are co-owners — the rule orders by a sequence), "parts"
 *  (the rows are different records of one id — keep the largest), "copies" (identical rows of a join — nothing to say). */
export const stackKindOf = (rule) => (rule.order ? "owners" : rule.prefer === "largest" ? "parts" : "copies");

/** Collapse rows that share `rule.by` into ONE feature per key, in first-seen order. A row with no key is its own lot, never merged.
 *  Each kept feature is a shallow copy carrying `stack: { rows, kind }` when it stood for more than one row. */
export function collapseStacked(feats, rule) {
  const list = feats || [];
  if (!rule || !rule.by || list.length < 2) return list;
  const order = [];
  const groups = new Map();
  list.forEach((f, i) => {
    const v = attrValue(f && f.attributes, rule.by);
    const key = present(v) ? `k:${String(v).trim().toUpperCase()}` : `i:${i}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(f);
  });
  if (order.length === list.length) return list;
  return order.map((key) => {
    const rows = groups.get(key);
    const keep = representative(rows, rule);
    return rows.length > 1 ? { ...keep, stack: { rows: rows.length, kind: stackKindOf(rule) } } : keep;
  });
}

/** The lot under a point out of every row the layer returned there: collapse the rows of one lot, prefer a lot whose ring holds the point,
 *  and remember the OTHER lots at that spot (`stack.others`) so the card can say so rather than silently drop them. */
export function pickAtPoint(feats, rule, lng, lat, contains) {
  const list = feats || [];
  if (!list.length) return null;
  if (!rule || !rule.by) return list[0];
  const lots = collapseStacked(list, rule);
  const hit = (contains && lots.find((f) => contains(f, lng, lat))) || lots[0];
  const others = lots.filter((f) => f !== hit).map((f) => {
    const label = rule.labelField ? attrValue(f.attributes, rule.labelField) : undefined;
    return { label: present(label) ? String(label).trim() : null };
  });
  if (!others.length) return hit;
  const stack = { rows: (hit.stack && hit.stack.rows) || 1, kind: hit.stack ? hit.stack.kind : stackKindOf(rule), others };
  return { ...hit, stack };
}

/** One short plain line for a card, or null when there is nothing worth saying (a join's identical copies are not news). */
export function stackNote(feature) {
  const s = feature && feature.stack;
  if (!s) return null;
  const parts = [];
  if (s.kind === "owners" && s.rows > 1) parts.push(`${s.rows} owners are on record for this lot — showing the first.`);
  if (s.kind === "parts" && s.rows > 1) parts.push(`${s.rows} records share this ID — showing the largest.`);
  if (s.others && s.others.length) {
    const names = s.others.map((o) => o.label).filter(Boolean);
    parts.push(s.others.length === 1
      ? `Another lot overlaps this spot${names.length ? ` (${names[0]})` : ""}.`
      : `${s.others.length} other lots overlap this spot${names.length ? ` (${names.join(", ")})` : ""}.`);
  }
  return parts.length ? parts.join(" ") : null;
}

/** The key one lot is known by, for the outline layer and the lot identity: the rule's field value when the row has it. */
export function stackKeyOf(attrs, rule) {
  if (!rule || !rule.by) return null;
  const v = attrValue(attrs, rule.by);
  return present(v) ? String(v).trim() : null;
}

/** The outline layer holds one ghost per `feature.id`. For a layer that stacks rows on a lot (`rule.outlines`) every row of a lot is given the SAME id (`s:<key>`) and a batch keeps the first of each, so
 *  Pick county lots draws ONE polygon where Bartow's join holds 170. A row whose key is not in its properties keeps the server's id. Mutates and returns the (possibly shorter) array. */
export function rekeyStackedOutlines(features, rule) {
  if (!rule || !rule.by || !features || !features.length) return features;
  const seen = new Set();
  const out = [];
  for (const f of features) {
    const k = f ? stackKeyOf(f.properties || f.attributes, rule) : null;
    if (k != null) {
      const id = `s:${k}`;
      f.id = id;
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(f);
  }
  return out;
}
