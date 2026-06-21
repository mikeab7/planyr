/* Title-block scoring harness (B356) — pure, dependency-free, NOT in the app bundle.
 *
 * The handoff's tuning task (V79 filing + V67 scale): for each training PDF, read its embedded
 * text, run the REAL readers (readTitleBlockText + matchProjectInText + parseSheetScale), and
 * SCORE the output against ground truth. GROUND TRUTH = THE FILENAME — the owner names files
 * descriptively ("2024-10-22 - JACINTOPORT - STRUCTURAL - IFC.pdf" ⇒ project Jacintoport,
 * discipline Structural, date 2024-10-22, revision IFC), so no separate answer key is needed.
 *
 * This module is the pure engine; ui-audit/score-filing.mjs is the runner that pulls each file's
 * text and prints the scorecard. It imports the SAME readers the app ships, so a green scorecard
 * means the live reader is right — and a red cell points straight at the table/regex to tune
 * (TYPE_RULES, parseRevision, matchProject signals, parseSheetScale patterns), with a unit test
 * added per real example to lock it in.
 *
 * Honesty: this does NOT fabricate corpus data. The fixtures at the bottom are clearly-labelled
 * SYNTHETIC, only to self-test the scoring logic in CI; the real corpus (the owner's ~9 text PDFs)
 * is dropped into ui-audit/corpus/ once the Drive connector is re-authed to michael@planyr.io.
 */
import { readTitleBlockText } from "../../src/shared/files/titleBlockParse.js";
import { matchProjectInText } from "../../src/shared/files/matchProject.js";
import { parseSheetScale } from "../../src/shared/files/sheetScale.js";
import { latestDate, parseRevision } from "../../src/shared/files/titleBlockParse.js";

/* The owner's named projects (confirm the canonical list + aliases with the owner). NAMES are the
 * only signal filled in here; the strong identifiers a title block actually prints — parcel #,
 * job #, street address — must be added from the owner's real data before the parcel/job/address
 * signals can fire on sheet text. (On real sheets those should be the PRIMARY signal: a bare
 * generic name like "Mesa" is exactly the "never auto-guess" risk, so it scores below the
 * auto-file floor on its own — see matchProject.scoreProjectInText.) */
export const KNOWN_PROJECTS = [
  { id: "jacintoport", name: "Jacintoport", aliases: { names: ["Jacinto Port"], parcels: [], jobNumbers: [], addresses: [] } },
  { id: "mesa", name: "Mesa", aliases: { names: [], parcels: [], jobNumbers: [], addresses: [] } },
  { id: "bergstrom", name: "Bergstrom", aliases: { names: ["Bergstrom Phase 2a", "Bergstrom Ph2a", "Bergstrom Ph 2a"], parcels: [], jobNumbers: [], addresses: [] } },
  { id: "kennedy-greens", name: "Kennedy Greens", aliases: { names: ["Kennedy Green"], parcels: [], jobNumbers: [], addresses: [] } },
  { id: "katy-grand", name: "Katy Grand", aliases: { names: ["KG Building 1", "KG B1", "Katy Grand Building 1"], parcels: [], jobNumbers: [], addresses: [] } },
];

/* GROUND-TRUTH discipline vocabulary read off a filename — RICHER than the reader's fixed
 * DISCIPLINES set on purpose, so Structural / Plumbing / Electrical / Mechanical / Fire Protection
 * are named as what the file truly is. `DISC_EQUIV` then says which reader output counts as correct
 * TODAY: the ones with no dedicated bucket can only resolve to "Other", and `gap:true` flags that
 * — the exact signal for the owner's open question (does Fire Protection / Structural / MEP deserve
 * its own bucket?). Order = most specific first. */
const FILENAME_DISC = [
  [/\balta\b/i, "Survey"],
  [/\bboundary\b/i, "Survey"],
  [/\btopo(graphic|graphy)?\b/i, "Survey"],
  [/\bsurvey\b/i, "Survey"],
  [/\bplat\b/i, "Survey"],
  [/\bcivil\b/i, "Civil"],
  [/\bgrading\b/i, "Civil"],
  [/\bpaving\b/i, "Civil"],
  [/\bstructural\b|\bstruct\b/i, "Structural"],
  [/\bfire\s*(protection|sprinkler)?\b/i, "Fire Protection"],
  [/\bplumbing\b|\bplumb\b/i, "Plumbing"],
  [/\belectrical\b|\belec\b/i, "Electrical"],
  [/\bmechanical\b|\bmech\b|\bhvac\b/i, "Mechanical"],
  [/\bm\.?e\.?p\.?\b/i, "MEP"],
  [/\barch(itectural)?\b/i, "Architectural"],
  [/\bfloor\s*plan\b/i, "Architectural"],
  [/\bland\s*scape\b/i, "Landscape"],
  [/\benvironmental\b|\besa\b/i, "Environmental"],
  [/\bgeotech(nical)?\b/i, "Geotech"],
];

// Which reader (DISCIPLINES-set) outputs count as correct for each ground-truth label. Where the
// reader has NO dedicated bucket, "Other" is the only honest answer → that pair is a taxonomy gap.
const DISC_EQUIV = {
  Survey: ["Survey"], Civil: ["Civil"], Architectural: ["Architectural"],
  Landscape: ["Landscape"], Environmental: ["Environmental"], Geotech: ["Geotech"],
  Structural: ["Other"], Plumbing: ["Other"], Electrical: ["Other"],
  Mechanical: ["Other"], MEP: ["Other"], "Fire Protection": ["Other"],
};
const GAP_DISCIPLINES = new Set(["Structural", "Plumbing", "Electrical", "Mechanical", "MEP", "Fire Protection"]);

const baseName = (name) => (name || "").replace(/\.[a-z0-9]+$/i, "");

// First known project whose name/alias appears in the filename, else "". (A filename literally
// carries the project name, so a plain phrase search is the right ground-truth read — no
// confidence gate, unlike sheet-text matching.)
export function projectFromFilename(name, projects = KNOWN_PROJECTS) {
  const hay = ` ${baseName(name).toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  for (const p of projects) {
    const names = [p.name, ...((p.aliases && p.aliases.names) || [])];
    for (const n of names) {
      const needle = ` ${String(n).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
      if (needle.trim().length >= 3 && hay.includes(needle)) return p.name;
    }
  }
  return "";
}

export function disciplineFromFilename(name) {
  const b = baseName(name);
  for (const [re, disc] of FILENAME_DISC) if (re.test(b)) return disc;
  return "";
}

/* Parse the expected fields out of a descriptive filename (the ground truth). Reuses the SHIPPED
 * date + revision readers (so the harness and the app agree on those formats). Returns
 * { project, discipline, date, revision }; any unknown field is "". */
export function expectedFromFilename(name, projects = KNOWN_PROJECTS) {
  const b = baseName(name);
  return {
    project: projectFromFilename(name, projects),
    discipline: disciplineFromFilename(name),
    date: latestDate(b),
    revision: parseRevision(b),
  };
}

/* Run the REAL readers over a sheet's extracted text → the same field bundle, plus the project
 * the matcher would file it under (name, or "" when it routes to "needs filing"). */
export function readFilingFields(text, projects = KNOWN_PROJECTS) {
  const f = readTitleBlockText(text);
  const m = matchProjectInText(text, projects);
  const project = m.matched ? (projects.find((p) => p.id === m.projectId) || {}).name || "" : "";
  return {
    hasText: f.hasText,
    project,
    matchConfidence: +(m.confidence || 0).toFixed(3),
    needsFiling: m.needsFiling,
    matchReason: m.reason,
    discipline: f.discipline,
    item: f.item,
    date: f.date,
    revision: f.revision,
    scale: f.scale || parseSheetScale(text), // identical to f.scale; explicit for clarity
  };
}

const eq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

function disciplineOk(expected, got) {
  if (!expected) return { ok: null, gap: false }; // no ground-truth discipline in the filename → not scored
  if (eq(expected, got)) return { ok: true, gap: false };
  const accept = DISC_EQUIV[expected] || [];
  const ok = accept.some((a) => eq(a, got));
  return { ok, gap: ok && GAP_DISCIPLINES.has(expected) }; // "passes" only by resolving to Other
}

/* Score one file. `ok:null` for a field = no ground truth in the filename (not counted). The
 * scale field is reported (got only) — the filename rarely states scale, so it's validated
 * against the plan's real scale by eye, not auto-graded. */
export function scoreFile({ name, text, projects = KNOWN_PROJECTS }) {
  const expected = expectedFromFilename(name, projects);
  const got = readFilingFields(text, projects);
  const disc = disciplineOk(expected.discipline, got.discipline);
  const fields = {
    project: { expected: expected.project, got: got.project, ok: expected.project ? eq(expected.project, got.project) : null },
    discipline: { expected: expected.discipline, got: got.discipline, ok: disc.ok, gap: disc.gap },
    date: { expected: expected.date, got: got.date, ok: expected.date ? eq(expected.date, got.date) : null },
    revision: { expected: expected.revision, got: got.revision, ok: expected.revision ? eq(expected.revision, got.revision) : null },
    scale: { expected: "", got: got.scale ? got.scale.label || (got.scale.explicit === "nts" ? "NOT TO SCALE" : "") : "", ok: null },
  };
  return { name, hasText: got.hasText, expected, got, fields };
}

export function scoreCorpus(files, projects = KNOWN_PROJECTS) {
  const rows = files.map((f) => scoreFile({ ...f, projects }));
  const FIELDS = ["project", "discipline", "date", "revision"];
  const totals = {};
  for (const k of FIELDS) {
    let pass = 0, scored = 0, gaps = 0;
    for (const r of rows) {
      const c = r.fields[k];
      if (c.ok === null) continue;
      scored++;
      if (c.ok) pass++;
      if (c.gap) gaps++;
    }
    totals[k] = { pass, scored, gaps, pct: scored ? Math.round((100 * pass) / scored) : null };
  }
  return { rows, totals, count: rows.length };
}

const cell = (c) => {
  if (c.ok === null) return `· ${c.got || "—"}`;
  const mark = c.ok ? (c.gap ? "△" : "✓") : "✗";
  return c.ok && !c.gap ? `${mark} ${c.got || "—"}` : `${mark} ${c.got || "—"} (want ${c.expected || "—"})`;
};

/* A plain-text scorecard for the CLI runner. △ = "correct only because it resolved to Other"
 * (a taxonomy gap to raise with the owner); ✗ = a genuine miss to tune; · = not graded. */
export function formatScorecard(result) {
  const lines = [];
  for (const r of result.rows) {
    lines.push(`\n📄 ${r.name}${r.hasText ? "" : "   ⚠️ NO EMBEDDED TEXT (scanned → AI/OCR fallback, not Tier-1)"}`);
    lines.push(`   project    ${cell(r.fields.project)}`);
    lines.push(`   discipline ${cell(r.fields.discipline)}`);
    lines.push(`   date       ${cell(r.fields.date)}`);
    lines.push(`   revision   ${cell(r.fields.revision)}`);
    lines.push(`   scale      ${cell(r.fields.scale)}`);
  }
  lines.push("\n──────── totals (graded fields only) ────────");
  for (const [k, t] of Object.entries(result.totals)) {
    if (t.pct === null) { lines.push(`   ${k.padEnd(11)} (none graded)`); continue; }
    lines.push(`   ${k.padEnd(11)} ${t.pass}/${t.scored}  (${t.pct}%)${t.gaps ? `   △ ${t.gaps} via Other (taxonomy gap)` : ""}`);
  }
  return lines.join("\n");
}

/* SYNTHETIC fixtures — NOT the owner's real sheets. They mirror the SHAPE of the corpus (a
 * descriptive filename + a hand-written scrap of title-block text) ONLY to prove the scoring
 * engine works in CI. Replace with the real ui-audit/corpus/ text once Drive is re-authed. */
export const SYNTHETIC_FIXTURES = [
  {
    name: "2024-10-22 - JACINTOPORT - STRUCTURAL - IFC.pdf",
    text: "JACINTOPORT DISTRIBUTION CENTER  FOUNDATION PLAN  STRUCTURAL  SHEET NO. S-101  ISSUED FOR CONSTRUCTION IFC  10/22/2024  SCALE: 1\"=20'",
  },
  {
    name: "Bergstrom Phase 2a - Arch IFP 2025.10.24.pdf",
    text: "BERGSTROM PHASE 2A  FLOOR PLAN  ARCHITECTURAL  SHEET A-201  ISSUED FOR PERMIT IFP  10/24/2025  1/8\"=1'-0\"",
  },
  {
    name: "2023.05.30 Mesa - Plumbing.pdf",
    text: "MESA LOGISTICS PARK  PLUMBING PLAN  SHEET P-1  PLUMBING  05/30/2023  SCALE: AS NOTED",
  },
  {
    name: "Mesa - Architectural Record Drawings.pdf",
    text: "MESA  RECORD DRAWINGS  ARCHITECTURAL FLOOR PLAN  SHEET A-101  1/16\" = 1'-0\"",
  },
];
