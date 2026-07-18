/* Oil & gas well status classification + proximity summary — public-data screening PHASE 4.
 * Pure. Turns RRC well points near the parcel into a status breakdown (producing vs
 * plugged/abandoned vs dry/injection) and an OFFSET / REPLUG RISK flag when a well sits on
 * the footprint: an old plug under a proposed building may not meet modern standards (a
 * re-plug cost), and a producing/active well forces setbacks. Screening only — the RRC
 * records search / a survey is the authoritative check.
 */
import { fmtDistFt } from "./proximityScreen.js";

// SYMNUM / GIS_SYMBOL_DESCRIPTION → a well category. Description-first (survives a SYMNUM
// renumber), SYMNUM as backup. Pure.
export function classifyWell(attrs = {}) {
  const desc = String(attrs.GIS_SYMBOL_DESCRIPTION || "").toLowerCase();
  const n = Number(attrs.SYMNUM);
  if (/plugged/.test(desc) || [7, 8, 10, 116, 152].includes(n)) return "plugged";
  if (/\bdry\b/.test(desc) || n === 3) return "dry";
  if (/cancel|abandon/.test(desc) || n === 9) return "abandoned";
  if (/shut-?in/.test(desc) || [19, 20].includes(n)) return "shutin";
  if (/inject|disposal/.test(desc) || [11, 21, 22, 23].includes(n)) return "injection";
  if (/oil|gas/.test(desc) || [4, 5, 6].includes(n)) return "producing";
  return "other";
}

// A category is a "replug-class" well (a physical hole that may sit under a pad): plugged,
// abandoned, dry, or producing/shut-in. Permitted-only / observation are not. Pure.
const PHYSICAL = new Set(["plugged", "abandoned", "dry", "producing", "shutin", "injection"]);

/* Summarize the wells the proximity screen returned (`scr` = screenProximity result) into a
 * status-aware finding. `total` is the exact count within the buffer (returnCountOnly); the
 * ranked sample drives the breakdown + on-site risk. Returns { status, summary, detail }. Pure. */
export function summarizeWells(scr, { total = null, bufferMi = 0.25 } = {}) {
  const ranked = (scr && scr.ranked) || [];
  const n = total != null ? total : ranked.length;
  if (n === 0) return { status: "absent", summary: null, detail: [] }; // caller supplies absentLabel

  const cats = {};
  for (const f of ranked) { const c = classifyWell(f.attrs); cats[c] = (cats[c] || 0) + 1; }
  const pluggedAbandoned = (cats.plugged || 0) + (cats.abandoned || 0);
  const producing = (cats.producing || 0) + (cats.shutin || 0);
  const onSite = ranked.filter((f) => f.distFt != null && f.distFt <= 25 && PHYSICAL.has(classifyWell(f.attrs)));

  const parts = [];
  if (pluggedAbandoned) parts.push(`${pluggedAbandoned} plugged/abandoned`);
  if (producing) parts.push(`${producing} producing`);
  if (cats.dry) parts.push(`${cats.dry} dry`);
  if (cats.injection) parts.push(`${cats.injection} injection`);

  let summary = `${n} well${n === 1 ? "" : "s"} within ${bufferMi} mi`;
  if (parts.length) summary += ` — ${parts.join(", ")}`;
  if (ranked.length && ranked.length < n) summary += ` (breakdown from the nearest ${ranked.length})`;
  if (onSite.length) summary += ` · ⚑ ${onSite.length} on the site — offset/replug risk`;

  const detail = ranked.slice(0, 8).map((f) => {
    const d = f.attrs.GIS_SYMBOL_DESCRIPTION || classifyWell(f.attrs);
    const api = f.attrs.API ? `API ${f.attrs.API}` : "well";
    const dist = fmtDistFt(f.distFt);
    return `${api} — ${d}${dist ? " · " + dist : ""}`;
  });
  return { status: "present", summary, detail };
}
