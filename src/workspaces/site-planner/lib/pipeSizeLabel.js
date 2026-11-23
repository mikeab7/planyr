/* DeSoto / Olive Branch pipe-size label — split out of desotoLayers.js (a lazy per-state layer file) so layerRequest.js stays eager-light. */
/* A pipe-size string the city typed by hand → the short label printed beside the line, or null when there is nothing to say.
 * Measured values include: 8" · 8'' · 8 (bare) · "2\" Abandoned" · "6 HP\"" · "FUTURE 6" · "FDC 4\"" · "None" · a stray creek name. */
export function pipeSizeLabel(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s || /^none$/i.test(s)) return null;
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return /abandon/i.test(s) ? "abandoned" : null;
  const n = m[1];
  const hp = /\bHP\b/i.test(s) ? " HP" : "";
  if (/future/i.test(s)) return `${n}" future`;
  if (/abandon|\bab\b/i.test(s)) return `${n}" abandoned`;
  return `${n}"${hp}`;
}
