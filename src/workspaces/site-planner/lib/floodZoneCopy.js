/* NEW-1 / NEW-2 / NEW-3 / NEW-7 — THE WORDS AND THE PROVENANCE for a FEMA flood answer.
 *
 * Sibling of `floodZone.js`, which is the CLASSIFIER. That module decides WHICH of the eight
 * variants a polygon is; this one decides what to SAY about it, and who published it.
 *
 * ⛔ THIS MODULE IS REACHED ONLY BY DYNAMIC IMPORT, AND THAT IS THE POINT. Its consumers are the
 * lazily-loaded hover path (`rasterIdentify.js`) and the Layers panel's own loader. A STATIC edge
 * from anything on the boot path would hoist every sentence below into the site-route chunk —
 * which is the trap the export path was split for, and which this strand had to pay off in order
 * to ship at all: the site route had 0.4 KB of headroom, and the flood work needed six. Copy and
 * provenance are click-into-detail material; engine code is not. Keep them apart.
 *
 * ⛔ THE ANSWER LEADS; FEMA'S CODE IS PROVENANCE (owner refinement, 2026-07-30, verbatim: "FEMA's
 * label is provenance, not the headline"):
 *
 *     answer  — what this MEANS for the site, in words, first:   "No mapped floodplain"
 *     code    — which FEMA label produced it, second:            "FEMA Zone X (unshaded)"
 *     headline = `${answer} · ${code}`
 *
 * The two Zone X states must read as OPPOSITE answers at a glance, because they ARE opposite:
 * shaded X is a real constraint that drives COH Ch.19's finished-floor rule and Fort Bend's
 * mitigation trigger, and it used to render identically to the all-clear.
 *
 * ⛔ "MAPPED" IS LOAD-BEARING — never write "No floodplain". Unshaded X means FEMA did not MAP a
 * hazard there; it does not mean the site cannot flood. Local drainage, unmapped tributaries,
 * sheet flow and town master-plan drainageways all sit outside FEMA's studies (Johnstown's own
 * Storm Water Master Plan is exactly such a case). "No floodplain" is a claim this app cannot
 * support, and no wording here may imply it.
 *
 * Pure: no DOM, no network. */
import { resolveFloodZone } from "./floodZone.js";

const s = (v) => (v == null ? "" : String(v)).trim();
const up = (v) => s(v).toUpperCase();

/* The words for each variant, plus `drawn` — does FEMA paint it? That last one is what answers
 * "why is the map empty?" (NEW-2), and it lives here because explaining a blank map is the only
 * thing that reads it. `undrawn: true` marks the ONE variant FEMA's layer-28 renderer has no
 * symbol for; `unknown: true` marks the ones we cannot say either way about. */
const COPY = {
  floodway: {
    answer: "Regulatory floodway",
    code: "FEMA Zone",           // + the real zone code, appended below — a floodway IS in an A zone
    short: "the channel that has to carry the 100-year flood — fill is a hard stop",
  },
  sfha: {
    answer: "100-year floodplain",
    code: "FEMA Zone",           // + the real zone code, appended below
    short: "a mapped Special Flood Hazard Area — the regulatory 1%-annual-chance floodplain",
  },
  "shaded-x": {
    answer: "500-year floodplain",
    code: "FEMA Zone X (shaded)",
    short: "inside the 0.2%-annual-chance floodplain, outside the 100-year — some ordinances extend fill and finished-floor rules to this band",
  },
  "unshaded-x": {
    undrawn: true,
    answer: "No mapped floodplain",
    code: "FEMA Zone X (unshaded)",
    short: "outside the 100-year AND 500-year floodplains — FEMA maps no flood hazard here, which is not the same as the site being unable to flood",
  },
  "x-unstated": {
    unknown: true,
    answer: "Floodplain status unresolved",
    code: "FEMA Zone X (no subtype)",
    short: "FEMA publishes no subtype here, so shaded (500-year) versus unshaded cannot be told apart",
  },
  "x-future": {
    answer: "Future-conditions floodplain",
    code: "FEMA Zone X (future conditions)",
    short: "a planning surface for future 1% flows — not the effective regulatory floodplain",
  },
  "x-levee": {
    answer: "Levee-reduced risk",
    code: "FEMA Zone X (levee)",
    short: "risk reduced by a levee — no mapped floodplain, and the reduction depends on the levee staying accredited",
  },
  d: {
    answer: "Flood hazard undetermined",
    code: "FEMA Zone D",
    short: "FEMA has not studied this area — undetermined is not an all-clear",
  },
  other: { unknown: true, answer: "Flood hazard area", code: "FEMA Zone", short: "" },
};

/* NEW-7 — THE THIRD STATE, AND IT IS NOT A FALSY ZONE.
 *
 * "FEMA has no data here" and "FEMA checked and found no floodplain" are OPPOSITE risk positions,
 * and every surface in this app has to be able to tell them apart. NFHL does not cover everywhere,
 * queries fail, and a coverage gap returns exactly what clear ground returns: nothing. If absence
 * renders as the all-clear, the app tells a developer their site is clear when nobody has ever
 * studied it — the same failure family as the invisible Buildability rows, the dropped
 * ParcelDrawing swatch, the discarded detVerdict and the permanent Colorado spinner.
 *
 * So absence is REPRESENTABLE: these are resolved answers with the same shape as a zone, never a
 * missing one. Anything consuming a flood answer branches on `kind`, not on truthiness. */
export const FLOOD_ABSENCE = {
  "no-data": {
    kind: "no-data",
    answer: "FEMA flood data not available here",
    short: "no effective FEMA flood map covers this location — unknown, NOT an all-clear",
    tone: "warn",
  },
  unreachable: {
    kind: "unreachable",
    answer: "FEMA flood data couldn't be reached",
    short: "the flood map service didn't answer — flood status here is unknown, not clear",
    tone: "warn",
  },
};

/* The absence answer for a state, in the same { answer, short, headline, tone } shape a resolved
 * zone produces — so a caller renders one or the other with no special-casing. Pure. */
export function floodAbsence(kind) {
  const a = FLOOD_ABSENCE[kind] || FLOOD_ABSENCE["no-data"];
  return { ...a, code: null, headline: a.answer, drawn: null, zone: null, variant: a.kind };
}


/* Turn a CLASSIFIED zone (floodZone.resolveFloodZone) into what a surface says about it. Accepts
 * either the resolved object or raw NFHL attributes, so a caller with attributes in hand does not
 * have to resolve first. Returns null for a non-zone. Pure. */
export function describeFloodZone(input) {
  const r = input && input.variant ? input : resolveFloodZone(input);
  if (!r) return null;
  const c = COPY[r.variant] || COPY.other;
  /* The SFHA and floodway codes carry the real zone letter ("FEMA Zone AE"); the X variants and
   * Zone D already name themselves. One expression, so the two can't drift. */
  const code = c.code === "FEMA Zone" ? (r.zone ? `FEMA Zone ${r.zone}` : "FEMA flood zone") : c.code;
  return {
    ...r,
    answer: c.answer,
    code,
    headline: `${c.answer} · ${code}`,
    // `label` is the code without the "FEMA " prefix — what a mid-sentence mention reads as
    // ("Zone X (unshaded)"). Its own field so callers never slice the string.
    label: code.replace(/^FEMA /, ""),
    short: c.short,
    drawn: c.undrawn ? false : c.unknown ? null : true,
  };
}

/* WHY THE MAP IS EMPTY, when it honestly is. Returns a short sentence for a zone FEMA paints
 * nothing for, and null otherwise — so a caller can append it without a conditional of its own.
 * This is the whole of NEW-2: an empty map that says why is an answer; a silent one reads as a
 * broken layer. Pure. */
export function undrawnReason(resolved) {
  if (!resolved || resolved.drawn !== false) return null;
  return "Nothing draws because FEMA paints no colour for unshaded X — not a failed layer.";
}

/* ---------------------------------------------------------------------------
 * NEW-3 — WHOSE FIRM answered.
 *
 * `DFIRM_ID` is the study id: a 5-digit FIPS (2 state + 3 county) plus a study letter, e.g.
 * `08069C` = Larimer County, Colorado. FIRM panels do not cross county lines, so on a
 * county-line site it matters which study answered — and a site straddling the line can be
 * covered by two studies with different effective dates and different published elevations.
 *
 * ⛔ THE COUNTY TABLE IS DELIBERATELY SMALL, AND THE FALLBACK IS THE POINT. Naming all ~3,200
 * US counties would put a table this app never reads into the site bundle. It carries the
 * counties Planyr actually supports (the Houston-MSA set + the nine Colorado targets, each FIPS
 * verified against FEMA's own Political Jurisdictions layer on 2026-07-30) and degrades to the
 * STATE name plus the raw id anywhere else — "FIRM 12086C (Florida)" — which is honest and
 * still more use than a bare id. Widening it is a data edit, not a code change.
 * ------------------------------------------------------------------------- */

/* Both tables are authored as ONE delimited string and expanded on first use, not as object
 * literals. That is not tidiness: this module rides the site-route chunk, which had 0.4 KB of
 * budget headroom when this landed (the audit in ui-audit), and the literal form spends roughly
 * twice the bytes on quotes, colons and commas. Same data, half the weight, parsed once.
 * Format: `FIPS` immediately followed by the name, entries space-separated. */
const expand = (packed) => {
  const out = {};
  for (const row of packed.split(" ")) {
    const cut = row.search(/[^0-9]/);
    out[row.slice(0, cut)] = row.slice(cut).replace(/_/g, " ");
  }
  return out;
};

export const STATE_FIPS = expand(
  "01Alabama 02Alaska 04Arizona 05Arkansas 06California 08Colorado 09Connecticut 10Delaware " +
  "11District_of_Columbia 12Florida 13Georgia 15Hawaii 16Idaho 17Illinois 18Indiana 19Iowa " +
  "20Kansas 21Kentucky 22Louisiana 23Maine 24Maryland 25Massachusetts 26Michigan 27Minnesota " +
  "28Mississippi 29Missouri 30Montana 31Nebraska 32Nevada 33New_Hampshire 34New_Jersey " +
  "35New_Mexico 36New_York 37North_Carolina 38North_Dakota 39Ohio 40Oklahoma 41Oregon " +
  "42Pennsylvania 44Rhode_Island 45South_Carolina 46South_Dakota 47Tennessee 48Texas 49Utah " +
  "50Vermont 51Virginia 53Washington 54West_Virginia 55Wisconsin 56Wyoming",
);

/* 5-digit county FIPS → county name, for the counties this app is built for. Every entry was
 * read back from FEMA's NFHL Political Jurisdictions layer (2026-07-30) rather than recalled:
 * the Houston-MSA counties the planner's rules cover, and the nine Colorado targets
 * (coloradoRegions.js). Anywhere else, firmStudy falls back to the state — see its note. */
export const COUNTY_FIPS = expand(
  "48201Harris 48157Fort_Bend 48071Chambers 48473Waller 48339Montgomery 48039Brazoria " +
  "48167Galveston 48291Liberty 08001Adams 08005Arapahoe 08013Boulder 08014Broomfield " +
  "08031Denver 08059Jefferson 08069Larimer 08041El_Paso 08123Weld",
);

/* Decode a DFIRM_ID into the study that published it. Returns null for anything that is not a
 * FIPS-shaped id (FEMA also issues a handful of regional / statewide study ids). Pure.
 *
 * `name` is the WHO, with no id in it at all ("Larimer County, Colorado") — that is what a
 * glance-level surface shows. `label` adds the study id for a surface that has room. No caller
 * ever shows a bare id, which is what NEW-3 was filed about. */
export function firmStudy(dfirmId) {
  const id = up(dfirmId);
  const m = /^(\d{2})(\d{3})([A-Z]?)$/.exec(id);
  if (!m) return id ? { id, state: null, county: null, name: `FIRM ${id}`, label: `FIRM ${id}` } : null;
  const [, st, co] = m;
  const state = STATE_FIPS[st] || null;
  const county = COUNTY_FIPS[st + co] || null;
  const name = county ? `${county} County${state ? `, ${state}` : ""}` : (state || `FIRM ${id}`);
  const label = county || state ? `${name} (FIRM ${id})` : `FIRM ${id}`;
  return { id, state, county, name, label };
}

/* ⛔ A FIRM PANEL NUMBER IS NOT `FLD_AR_ID`, AND THE DIFFERENCE MATTERS (owner refinement,
 * 2026-07-30). The id in the old hover — "08069C_2802" — is the flood-zone RECORD id from layer
 * 28's display field. It is not a panel and cannot be decoded into one: at the owner's site the
 * real panel is 08069C1405G. So this decodes the FIRM PANELS layer (NFHL layer 3), which is where
 * `FIRM_PAN`, `PANEL` and `EFF_DATE` actually live, into the one sentence a developer wants when
 * they are about to go pull the FIRM or file a LOMR — and nothing shows a panel number that did
 * not come from here.
 *
 * `EFF_DATE` arrives as epoch ms. A missing date is simply omitted; it is never guessed. Pure. */
export function firmPanel(attrs) {
  if (!attrs) return null;
  const pan = s(attrs.FIRM_PAN != null ? attrs.FIRM_PAN : attrs.panel);
  const study = firmStudy(attrs.DFIRM_ID != null ? attrs.DFIRM_ID : attrs.firm);
  if (!pan && !study) return null;
  const ms = Number(attrs.EFF_DATE != null ? attrs.EFF_DATE : attrs.effDate);
  const eff = isFinite(ms) && ms > 0 ? new Date(ms) : null;
  const effText = eff
    ? eff.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
    : null;
  const who = study ? study.name : null;
  const label = [
    who && pan ? `${who} FIRM panel ${pan}` : who ? `${who} FIRM` : `FIRM panel ${pan}`,
    effText ? `effective ${effText}` : null,
  ].filter(Boolean).join(", ");
  return { id: study ? study.id : null, panel: pan || null, county: study ? study.county : null, effective: effText, label };
}

/* Do the zones returned for this site come from more than ONE FIRM study? On a county-line site
 * that is the fact worth flagging: two studies mean two effective dates and two sets of published
 * elevations, and reporting whichever one a single point landed in hides the other half.
 *
 * `rows` is anything carrying a `firm` / `DFIRM_ID` per zone. Returns
 * { studies: [{id,label,…}], multiple: boolean, text: string|null } — `text` is null when there
 * is nothing worth saying (no study id, or a single study, which is the ordinary case). Pure. */
export function firmStudySpan(rows) {
  const byId = new Map();
  for (const r of rows || []) {
    const st = firmStudy(r && (r.firm != null ? r.firm : r.DFIRM_ID));
    if (st && st.id && !byId.has(st.id)) byId.set(st.id, st);
  }
  const studies = Array.from(byId.values());
  const multiple = studies.length > 1;
  const names = studies.map((x) => (x.county ? `${x.county} County` : x.name));
  return {
    studies,
    multiple,
    // Glance level: WHO answered, never an id. The id + panel + effective date ride the basis
    // hover (see firmPanel), which is where a developer goes when they mean to pull the FIRM.
    text: !studies.length
      ? null
      : multiple
        ? `Two FIRM studies cover this site — ${names.join(" and ")}. Panels stop at the county line; check both.`
        : names[0],
  };
}

/* NEW-2 — THE FEMA FLOOD READOUT, which the generic row-specs above cannot produce honestly.
 *
 * What the owner saw: `Flood Hazard Zones: 08069c_2802` over `Type: X`. Both halves are the
 * generic path working as designed and both are useless — the headline is the service's
 * `displayField`, which on NFHL layer 28 is `FLD_AR_ID` (an internal record id), and the Type row
 * stops at the first field it recognises, which is FLD_ZONE. ZONE_SUBTY, the only field that
 * separates the 500-year band from the all-clear (both are "Zone X"), was fetched and dropped.
 *
 * ⛔ THE HOVER SHOWS THE ANSWER AND NOTHING ELSE (owner refinement, 2026-07-30, verbatim on the
 * record id: "I don't need that information. I don't know what that means"). So: no layer name,
 * no DFIRM id, no panel number, no record id — a glance at the map is not the moment anyone wants
 * a study identifier. The provenance (whose study, which panel, effective when, how old the data
 * is) lives on the Layers-panel readout's basis hover, where a developer goes when they mean to
 * pull the FIRM or file a LOMR. The answer LEADS and FEMA's code follows it as provenance:
 *     "No mapped floodplain · FEMA Zone X (unshaded)"
 *
 * It lives in the COPY module rather than in `rasterIdentify.js` so that every flood sentence in
 * the app has one home; `rasterIdentify` re-exports it for its own callers.
 *
 * Returns a readout, or null when the attributes are not a flood zone (the caller then falls
 * through to the generic path untouched). Pure. */
export function floodReadout(attrs) {
  const r = describeFloodZone(attrs);
  if (!r || !r.zone) return null;
  const rows = [];
  // A published BFE is the number a reader wants next, whenever the zone carries one.
  const bfe = Number(attrs.STATIC_BFE);
  if (isFinite(bfe) && bfe > -9000) rows.push({ label: "BFE", text: `${bfe}′` });
  // NEW-2 — why the map is blank, said at the moment the blankness is confusing.
  if (r.drawn === false) rows.push({ label: "Not drawn", text: "FEMA paints no colour for this zone — an empty map here is correct" });
  return { title: r.headline, rows };
}


// ---------------------------------------------------------------------------
// The Layers-panel FEMA verdict (moved here from floodGroup.js — see this file's header).
// ---------------------------------------------------------------------------
/* Turn resolveDrainageContext's `flood` block ({ zones, state }) into ONE honest line.
 *
 * The three states this function exists to distinguish (NEW-3):
 *   failed          → we could not reach FEMA. NOT "no flood zone."
 *   empty           → FEMA answered, and has no zone polygon mapped at this point.
 *   loaded, no SFHA → FEMA answered Zone X: minimal hazard, no SFHA here. THE ANSWER.
 *   loaded, SFHA    → an SFHA is mapped; name the zone.
 *
 * Returns { text, tone } where tone is "ok" | "warn" | "alert" — or null when there is
 * nothing yet to report (no check has run). Pure. */
export function femaZoneVerdict(flood) {
  if (!flood || !flood.state) return null;

  /* NEW-7 — THREE STATES, NOT TWO. "FEMA couldn't be reached" and "FEMA has no map here" are both
   * UNKNOWN, and neither may render like the all-clear. Both come from the one shared constant
   * (`FLOOD_ABSENCE`) that the hover reads too, and both carry a WARN tone — an unstudied site is
   * not a clear site. `basis` is the provenance the caller hangs on the line's hover. */
  if (flood.state === "failed") {
    const a = floodAbsence("unreachable");
    return { text: `${a.answer} — ${a.short}.`, tone: "warn", basis: null, kind: a.kind };
  }
  const zones = Array.isArray(flood.zones) ? flood.zones : [];
  if (!zones.length) {
    const a = floodAbsence("no-data");
    return { text: `${a.answer} — ${a.short}.`, tone: "warn", basis: null, kind: a.kind };
  }

  /* NEW-3 — WHOSE study answered. FIRM panels stop at the county line, so on a county-line site
   * "which study" is a real question, and a site whose extent spans two studies must not be
   * reported as if one point settled it. At glance level this is a COUNTY NAME and never an id:
   * the id, the panel number and its effective date ride `basis` (the line's hover), which is
   * where a developer goes when they mean to pull the FIRM or file a LOMR. */
  const span = firmStudySpan(zones);
  const study = span.text ? ` ${span.multiple ? span.text : `Mapped by ${span.text}.`}` : "";
  const basis = firmBasis(flood, span);

  /* THE ANSWER LEADS, FEMA'S CODE IS PROVENANCE (owner refinement) — and "no SFHA" is not one
   * answer but three, which the old line collapsed. Both variants of Zone X carry FLD_ZONE = "X";
   * only the subtype separates "inside the 500-year floodplain" from "no MAPPED flood hazard",
   * and this line used to lower-case whichever subtype came back and then assert "area of minimal
   * flood hazard" when there was none. It also read the FIRST zone only, so a shaded-X polygon
   * behind an unshaded one went unmentioned. Resolve every zone, let the higher hazard win, and —
   * for the unshaded case, which is what made the owner read a correct answer as a broken layer —
   * say WHY the map is blank. */
  const resolved = zones.map(describeFloodZone).filter(Boolean);
  const worst = resolved.find((r) => r.variant === "floodway")
    || resolved.find((r) => r.sfha)
    || resolved.find((r) => r.variant === "shaded-x")
    || resolved[0];
  if (!worst) {
    const a = floodAbsence("no-data");
    return { text: `${a.answer} — ${a.short}.`, tone: "warn", basis, kind: a.kind };
  }
  const tone = worst.sfha || worst.floodway ? "alert" : worst.shadedX ? "warn" : "ok";
  const why = undrawnReason(worst);
  /* A ring can straddle more than one SFHA zone (the Tsakiris tract reports X AND A). The
   * headline reports the WORST — an SFHA anywhere in the ring outranks minimal hazard elsewhere
   * in it — but it names every SFHA letter present, because "AE" and "A" carry different
   * consequences (a published BFE versus an unstudied approximate zone). */
  const letters = [...new Set(resolved.filter((r) => r.sfha).map((r) => r.zone).filter(Boolean))];
  const headline = worst.sfha && letters.length > 1
    ? `${worst.answer} · FEMA Zones ${letters.join(" + ")}`
    : worst.headline;
  return {
    text: `${headline} — ${worst.short}.${why ? ` ${why}` : ""}${study}`,
    tone,
    basis,
    kind: "zone",
  };
}

/* The provenance line for the FEMA readout's hover: the app's established
 * "As of <date> · <source> · <age>" shape, extended with the decoded FIRM panel (never a raw id).
 * Returns null when there is nothing honest to say. Pure. */
function firmBasis(flood, span) {
  const bits = [];
  // Dedupe HERE rather than at the fetch: a county-line site returns the same panel more than
  // once, and the fetch side rides the site-route chunk while this does not.
  for (const p of (flood.panels || [])) {
    const decoded = firmPanel(p);
    if (decoded && !bits.includes(decoded.label)) bits.push(decoded.label);
  }
  if (!bits.length) for (const st of span.studies) bits.push(`${st.name} (FIRM ${st.id}) — panel number not read`);
  if (!bits.length) return null;
  return `${bits.join(" · ")} · source: FEMA National Flood Hazard Layer${
    flood.ageMs != null ? ` · flood data ${fmtAge(flood.ageMs)}` : ""}`;
}

/* "3h ago" / "2d ago" — the age convention the flood group already shows. Pure. */
function fmtAge(ms) {
  const m = Math.max(0, Math.round(Number(ms) / 60000));
  if (!isFinite(m)) return "age unknown";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

