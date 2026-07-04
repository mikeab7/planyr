/* Legend symbol-union (B340 tail #3 / B338's remainder) — PURE + browser-free.
 *
 * WHAT. A drawing set's legend (the key of symbols → what they mean) is often split across sheets,
 * and cropping the title block (B338) can hide per-sheet legend panels. This engine UNIONS every
 * sheet's legend entries into ONE deduped key for the pinned Composite panel, so a symbol defined
 * on any sheet is available while viewing the whole stitched set — the graphical complement to the
 * text NOTES aggregation (sheetNotes.aggregateNotes) that already ships.
 *
 * CONTRACT. Consumes each sheet's already-extracted legend entries ([{ symbol?, text }]) — the
 * SYMBOL/graphic extraction that finds those entries on a real sheet is the DORMANT browser seam
 * (needs vector/symbol analysis, verified live), exactly like the other B340 tails. Absent that
 * extraction no sheet carries entries and the union is empty (fail open — the Composite key is
 * unchanged). The union itself (dedupe by meaning, keep the first symbol, record which sheets an
 * entry came from) is pure and unit-tested here.
 */

// Normalize an entry's description for dedupe: case/space-insensitive, punctuation-trimmed, so
// "C.J. = CONTROL JOINT" and "CJ  =  Control Joint" collapse to one entry.
const normText = (t) => (t || "").toString().toLowerCase().replace(/[.,;:]/g, " ").replace(/\s+/g, " ").trim();

/* Union legend entries across sheets. Input:
 *   perSheet = [{ sheet, entries: [{ symbol?, text }] }]   (sheet = a label like "M0.01" or "#3")
 * Returns [{ text, symbol, sheets:[...] }] in first-seen order, one row per distinct meaning:
 *   • deduped by normalized `text` (so the same key repeated across sheets is ONE row),
 *   • keeping the FIRST non-empty `symbol` seen for that meaning,
 *   • recording every sheet the entry appeared on (so a per-sheet-only symbol is still traceable).
 * A wrong merge is worse than a duplicate, so only entries with matching normalized text combine —
 * two different descriptions never fold together even if they share a symbol glyph. */
export function unionLegendEntries(perSheet = []) {
  const map = new Map();
  const order = [];
  for (const s of perSheet || []) {
    const sheetLabel = s && s.sheet != null ? String(s.sheet) : "";
    for (const e of (s && s.entries) || []) {
      if (!e) continue;
      const key = normText(e.text);
      if (!key) continue;
      if (!map.has(key)) { map.set(key, { text: (e.text || "").toString().trim(), symbol: e.symbol || null, sheets: [] }); order.push(key); }
      const rec = map.get(key);
      if (!rec.symbol && e.symbol) rec.symbol = e.symbol;
      if (sheetLabel && !rec.sheets.includes(sheetLabel)) rec.sheets.push(sheetLabel);
    }
  }
  return order.map((k) => map.get(k));
}

/* Convenience for the Stitcher's placed-sheet model: pull each placed sheet's legend entries
 * (s.legendEntries, populated by the dormant extractor) keyed by its sheet number / order, and
 * union them. Returns the same shape as unionLegendEntries. Empty until the extractor runs. */
export function legendFromPlaced(placed = []) {
  return unionLegendEntries((placed || []).map((s, i) => ({
    sheet: (s && s.sheetNumber) || `#${i + 1}`,
    entries: (s && s.legendEntries) || [],
  })));
}
