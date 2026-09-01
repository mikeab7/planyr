/* compParse — comp entry parsing: paste text -> typed grid rows (B849232/NEW-1).
 *
 * Two paste shapes, detected mechanically, never guessed at: a TAB-DELIMITED block (an Excel/
 * spreadsheet paste — any pasted line containing a tab) fills rows AND columns the way a
 * spreadsheet would; everything else is PROSE — one line, one comp, broker-email style
 * ("3.2 AC land - $850k - Jan 2026"). Both funnel into the same generic extraction ->
 * type-specific draft conversion, so the two paste shapes can never drift apart on what counts
 * as a rate, a size, or a date.
 *
 * UNCERTAINTY, the rule that matters (owner decision 2026-09-01): every parsed cell the parser
 * had to guess at carries a verdict, never silently — `null` (confident), `"soft"`, or
 * `"blocking"`. The line between them is NOT "how big is the risk" — it is **whether the risk
 * is visible in the cell's own shown value**:
 *   - SOFT: the parser guessed to reach the number shown, but the guess IS the shown number —
 *     "180k SF" reads as 180000 right there in the cell, so eyeballing it is enough to catch a
 *     bad guess. Never blocks a save.
 *   - BLOCKING: the shown value would be silently WRONG if the guess is wrong, because the risk
 *     lives in a field that ISN'T shown next to it. The canonical case: a lease rate with no
 *     stated period — "$0.68" reads identically whether it means $0.68/mo or $0.68/yr, and the
 *     two are 12x apart. Must be resolved before the row can save.
 * This module never resolves a blocking guess itself (never infers a period from a rate's
 * magnitude, for exactly the reason above) — it only ever refuses to guess and says why.
 */

const NUM_SUFFIX = { k: 1e3, m: 1e6, mm: 1e6, thousand: 1e3, million: 1e6 };

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const LEASE_WORDS = /\b(lease|leased|leasing|tenant|landlord|rent(?:ed|al)?)\b/i;
const BASIS_RE = /\b(nnn|triple\s*net|gross|full\s*service|\bfs\b)\b/i;
const SALE_WORDS = /\b(sold|sale|purchased?|closed|buyer|seller)\b/i;
const BUILDING_WORDS = /\b(building|warehouse|industrial|office|flex|shell|facility)\b/i;
const LAND_WORDS = /\b(land|acres?|\bac\b|\blot\b|tract|pad\s*site)\b/i;
const PERIOD_RE = /(\/\s*mo\b|\/\s*month\b|per\s+month\b|\bmonthly\b|\/\s*yr\b|\/\s*year\b|per\s+year\b|per\s+annum\b|\bannual(?:ly)?\b|\byearly\b)/i;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function isoFrom(y, mo, d) {
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A number token, handling comma-stripped digits and a k/m/thousand/million suffix. The
 * suffix expansion is what makes a value SOFT — the expanded number is fully shown, so it's
 * always correctable by eyeballing it, never a save-blocker. */
export function parseMagnitudeNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/^\$?\s*([\d,]*\.?\d+)\s*(k|m|mm|thousand|million)?\s*$/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const suffix = m[2]?.toLowerCase();
  const mult = suffix ? NUM_SUFFIX[suffix] : 1;
  return { value: n * mult, soft: !!suffix };
}

/** Find a date anywhere in free text: ISO, M/D/YYYY (US month-first), "Month D, YYYY", or a
 * bare "Month YYYY" (no day — defaults to the 1st, flagged soft since a day was assumed). */
export function findDateToken(text) {
  const s = String(text || "");
  let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) { const iso = isoFrom(+m[1], +m[2], +m[3]); return iso ? { iso, soft: false } : null; }
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) {
    const [, mo, da, yrRaw] = m;
    const y = yrRaw.length === 2 ? (Number(yrRaw) > 50 ? 1900 + Number(yrRaw) : 2000 + Number(yrRaw)) : Number(yrRaw);
    const iso = isoFrom(y, +mo, +da);
    return iso ? { iso, soft: false } : null;
  }
  m = s.match(/\b([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const iso = isoFrom(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
    return iso ? { iso, soft: false } : null;
  }
  m = s.match(/\b([A-Za-z]+)\.?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const iso = isoFrom(+m[2], MONTHS[m[1].toLowerCase()], 1);
    return iso ? { iso, soft: true } : null;
  }
  return null;
}

function detectPeriod(text) {
  const m = String(text || "").match(PERIOD_RE);
  if (!m) return null;
  const t = m[1].toLowerCase();
  return t.includes("mo") ? "monthly" : "annual";
}

function detectBasis(text) {
  const m = String(text || "").match(BASIS_RE);
  if (!m) return null;
  const t = m[1].toLowerCase();
  return t.startsWith("nnn") || t.includes("triple") ? "nnn" : "gross";
}

/** Best-effort comp type from wording — never blank, since every comp needs one, but flagged
 * soft whenever it was a guess rather than an explicit signal (lease words, or sale + a
 * building word). Defaults to "land", the app's own default, when nothing signals otherwise. */
export function detectCompType(text) {
  const t = String(text || "");
  if (LEASE_WORDS.test(t) || BASIS_RE.test(t) || /\/\s*sf\s*\/\s*(mo|yr)/i.test(t)) return { value: "lease", soft: false };
  const sale = SALE_WORDS.test(t);
  const building = BUILDING_WORDS.test(t);
  if (sale && building) return { value: "building_sale", soft: false };
  if (LAND_WORDS.test(t)) return { value: "land", soft: false };
  if (sale) return { value: "building_sale", soft: true };
  return { value: "land", soft: true };
}

function findRateToken(text) {
  const t = String(text || "");
  let m = t.match(/\$\s*([\d,]*\.?\d+)\s*(k|m)?\s*\/\s*sf\b/i);
  if (m) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) return null;
    const mult = m[2] ? NUM_SUFFIX[m[2].toLowerCase()] : 1;
    return { value: round2(n * mult), soft: !!m[2] };
  }
  // No explicit "/SF" marker — only treat a bare decimal dollar figure as a RATE (not a price)
  // when the line otherwise reads as a lease (a basis or a lease word present).
  if (LEASE_WORDS.test(t) || BASIS_RE.test(t)) {
    m = t.match(/\$\s*([\d,]*\.\d+)\b/);
    if (m) return { value: round2(Number(m[1].replace(/,/g, ""))), soft: false };
  }
  return null;
}

function findPriceToken(text) {
  const m = String(text || "").match(/\$\s*([\d,]*\.?\d+)\s*(k|m|mm|thousand|million)?\b/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const suffix = m[2]?.toLowerCase();
  const mult = suffix ? NUM_SUFFIX[suffix] : 1;
  return { value: n * mult, soft: !!suffix };
}

const SIZE_RE = /\b([\d,]*\.?\d+)\s*(k)?\s*(ac|acres?|sf|square\s*feet)\b/i;

function findSizeToken(text) {
  const m = String(text || "").match(SIZE_RE);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const soft = !!m[2];
  if (soft) n *= 1000;
  const unit = m[3].toLowerCase().startsWith("ac") ? "ac" : "sf";
  return { value: n, unit, soft };
}

function findTerm(text, compType) {
  if (compType !== "lease") return null;
  const m = String(text || "").match(/\b(\d+)\s*[- ]?\s*(yrs?|years?|mo|mos|months?)\b(?:\s*term)?/i);
  if (!m) return null;
  return /yr|year/i.test(m[2]) ? `${m[1]} yrs` : `${m[1]} mo`;
}

function findTi(text) {
  const m = String(text || "").match(/\bTI\b\s*(?:allowance)?\s*(?:of|:)?\s*\$?\s*([\d,]*\.?\d+)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function matchLabeled(text, re) {
  const m = String(text || "").match(re);
  return m ? m[1].trim() : null;
}

function mergeFlag(flags, key, level, reason) {
  const existing = flags[key];
  if (existing && existing.level === "blocking") return; // blocking never downgrades to soft
  flags[key] = { level, reason };
}

function emptyGeneric() {
  return {
    compType: null, compDate: null, title: null, partyProvider: null, partyAcquirer: null,
    price: null, sizeValue: null, sizeUnit: null, rate: null, ratePeriod: null, rateBasis: null,
    ti: null, term: null, notes: null,
  };
}

/** One prose line (broker-email style) -> generic fields + pre-remap uncertainty flags. */
function extractGenericFromProse(line) {
  const text = String(line || "");
  const g = emptyGeneric();
  const flags = {};

  const ct = detectCompType(text);
  g.compType = ct.value;
  if (ct.soft) flags.compType = { level: "soft", reason: "Type guessed from the wording — check it." };

  const dateTok = findDateToken(text);
  if (dateTok) {
    g.compDate = dateTok.iso;
    if (dateTok.soft) flags.compDate = { level: "soft", reason: "Day of month wasn't given — defaulted to the 1st." };
  }

  g.partyProvider = matchLabeled(text, /(?:landlord|owner|seller|developer)\s*:\s*([^,;|]+)/i);
  g.partyAcquirer = matchLabeled(text, /(?:tenant|buyer|user)\s*:\s*([^,;|]+)/i);

  const rateTok = findRateToken(text);
  if (rateTok) {
    g.rate = rateTok.value;
    if (rateTok.soft) mergeFlag(flags, "rate", "soft", "Had a k/m suffix — check the expanded value.");
    g.ratePeriod = detectPeriod(text);
    g.rateBasis = detectBasis(text);
  } else {
    const priceTok = findPriceToken(text);
    if (priceTok) {
      g.price = priceTok.value;
      if (priceTok.soft) mergeFlag(flags, "price", "soft", "Had a k/m suffix — check the expanded value.");
    }
  }

  const sizeTok = findSizeToken(text);
  if (sizeTok) {
    g.sizeValue = sizeTok.value;
    g.sizeUnit = sizeTok.unit;
    if (sizeTok.soft) mergeFlag(flags, "sizeValue", "soft", "Had a k/m suffix — check the expanded value.");
  }

  g.term = findTerm(text, g.compType);
  g.ti = findTi(text);

  return { generic: g, flags };
}

function remapFlagKey(key, compType) {
  if (key === "price") return compType === "building_sale" ? "bldgPrice" : "landPrice";
  if (key === "sizeValue") return compType === "land" ? "landSizeValue" : compType === "building_sale" ? "bldgSizeSf" : "leaseSizeSf";
  if (key === "rate") return "leaseRate";
  return key;
}

/** The ONE place a lease row's period/basis ambiguity is judged, shared by both paste shapes —
 * so "does this block" can never disagree between a pasted line and a pasted spreadsheet cell.
 * Remaps the generic-level flag keys (price/sizeValue/rate) onto the type-specific field the
 * grid actually renders, so a caller never has to know the generic vocabulary. */
function finalizeGenericRow(generic, rawFlags, raw) {
  const flags = {};
  for (const [k, v] of Object.entries(rawFlags)) flags[remapFlagKey(k, generic.compType)] = v;

  if (generic.compType === "lease" && generic.rate != null) {
    if (!generic.ratePeriod) {
      mergeFlag(flags, "leaseRatePeriod", "blocking",
        `No monthly/annual period was given — $${generic.rate} means something 12x different either way. Pick one before saving.`);
    }
    if (!generic.rateBasis) {
      mergeFlag(flags, "leaseRateExpense", "soft", "NNN vs gross wasn't given — check it.");
    }
  }

  return { draft: genericToDraft(generic), cellFlags: flags, raw };
}

/** Generic fields -> the string-keyed draft shape `comps.js`'s `draftToComp`/`insertComp`
 * expect (the same shape `emptyDraft`/`compToDraft` produce). Only fields the caller actually
 * has values for are set — an unset field stays at the blank default, per the entry grid's own
 * rule that an empty cell is just a cell. */
function genericToDraft(generic) {
  const d = {
    compType: "land", compDate: "", title: "", notes: "", teamId: null, projectId: null, anchor: null,
    partyProvider: "", partyAcquirer: "",
    landPrice: "", landSizeValue: "", landSizeUnit: "ac",
    bldgPrice: "", bldgSizeSf: "",
    leaseRate: "", leaseRatePeriod: "", leaseRateExpense: "", leaseTi: "", leaseTerm: "", leaseSizeSf: "",
    leaseFreeRentMonths: "",
  };
  d.compType = generic.compType || d.compType;
  if (generic.compDate) d.compDate = generic.compDate;
  if (generic.partyProvider) d.partyProvider = generic.partyProvider;
  if (generic.partyAcquirer) d.partyAcquirer = generic.partyAcquirer;

  if (d.compType === "land") {
    if (generic.price != null) d.landPrice = String(generic.price);
    if (generic.sizeValue != null) { d.landSizeValue = String(generic.sizeValue); d.landSizeUnit = generic.sizeUnit || "ac"; }
  } else if (d.compType === "building_sale") {
    if (generic.price != null) d.bldgPrice = String(generic.price);
    if (generic.sizeValue != null) d.bldgSizeSf = String(generic.sizeValue);
  } else if (d.compType === "lease") {
    if (generic.rate != null) d.leaseRate = String(generic.rate);
    if (generic.ratePeriod) d.leaseRatePeriod = generic.ratePeriod;
    if (generic.rateBasis) d.leaseRateExpense = generic.rateBasis;
    if (generic.sizeValue != null) d.leaseSizeSf = String(generic.sizeValue);
    if (generic.ti != null) d.leaseTi = String(generic.ti);
    if (generic.term) d.leaseTerm = generic.term;
  }
  return d;
}

/** One prose line -> `{ draft, cellFlags, raw }`. */
export function parseProseLine(line) {
  const { generic, flags } = extractGenericFromProse(line);
  return finalizeGenericRow(generic, flags, line);
}

/* ---- spreadsheet / Excel block paste ------------------------------------------------------ */

export function looksLikeSpreadsheetPaste(text) {
  return String(text || "").split(/\r?\n/).some((l) => l.includes("\t"));
}

export function splitPasteLines(text) {
  return String(text || "").split(/\r?\n/).map((l) => l.replace(/\r$/, "")).filter((l) => l.trim() !== "");
}

// Column header aliases (case-insensitive, exact cell match) -> the generic field they fill.
// Deliberately loose but not fuzzy-matched: an unrecognized header column is simply not used to
// fill any field (falls through to positional mapping only when NO header row is detected at
// all), which is safer than guessing what a stray column means.
const HEADER_ALIASES = {
  compType: ["type", "comp type", "kind"],
  compDate: ["date", "comp date", "closed", "close date"],
  title: ["title", "property", "deal", "address", "name"],
  partyProvider: ["landlord", "seller", "owner", "developer", "provider"],
  partyAcquirer: ["tenant", "buyer", "user", "acquirer"],
  price: ["price", "sale price", "land price", "bldg price", "building price"],
  sizeValue: ["size", "sf", "acres", "ac", "building sf", "leased sf", "land size"],
  sizeUnit: ["unit", "size unit"],
  rate: ["rate", "lease rate", "$/sf", "psf"],
  ratePeriod: ["period", "mo/yr"],
  rateBasis: ["basis", "nnn/gross", "expense"],
  ti: ["ti", "ti $/sf", "ti allowance"],
  term: ["term"],
  notes: ["notes", "comments"],
};

function matchHeader(cell) {
  const c = String(cell || "").trim().toLowerCase();
  if (!c) return null;
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(c)) return key;
  }
  return null;
}

const DEFAULT_COLUMN_ORDER = [
  "compType", "compDate", "partyProvider", "partyAcquirer", "price", "sizeValue", "rate", "ratePeriod", "rateBasis", "term", "notes",
];

function normalizeCompTypeToken(v) {
  const s = String(v).trim().toLowerCase();
  if (/^land/.test(s)) return "land";
  if (/^lease/.test(s)) return "lease";
  if (/build|sale/.test(s)) return "building_sale";
  return null;
}

function assignGenericCell(generic, flags, key, val) {
  switch (key) {
    case "compType": generic.compType = normalizeCompTypeToken(val); break;
    case "compDate": {
      const d = findDateToken(val);
      if (d) { generic.compDate = d.iso; if (d.soft) mergeFlag(flags, "compDate", "soft", "Day wasn't given — defaulted to the 1st."); }
      break;
    }
    case "title": generic.title = val; break;
    case "partyProvider": generic.partyProvider = val; break;
    case "partyAcquirer": generic.partyAcquirer = val; break;
    case "price": {
      const n = parseMagnitudeNumber(val.replace(/^\$/, ""));
      if (n) { generic.price = n.value; if (n.soft) mergeFlag(flags, "price", "soft", "Had a k/m suffix — check the expanded value."); }
      break;
    }
    case "sizeValue": {
      const n = parseMagnitudeNumber(val);
      if (n) { generic.sizeValue = n.value; if (n.soft) mergeFlag(flags, "sizeValue", "soft", "Had a k/m suffix — check the expanded value."); }
      if (/ac/i.test(val) && !/sf|square/i.test(val)) generic.sizeUnit = "ac";
      break;
    }
    case "sizeUnit": generic.sizeUnit = /ac/i.test(val) ? "ac" : "sf"; break;
    case "rate": {
      const n = parseMagnitudeNumber(val.replace(/^\$/, "").replace(/\/\s*sf/i, ""));
      if (n) { generic.rate = n.value; if (n.soft) mergeFlag(flags, "rate", "soft", "Had a k/m suffix — check the expanded value."); }
      break;
    }
    case "ratePeriod": generic.ratePeriod = /mo/i.test(val) ? "monthly" : /yr|year|annual/i.test(val) ? "annual" : null; break;
    case "rateBasis": generic.rateBasis = /nnn|net/i.test(val) ? "nnn" : /gross|fs|full/i.test(val) ? "gross" : null; break;
    case "ti": { const n = parseMagnitudeNumber(val.replace(/^\$/, "")); if (n) generic.ti = n.value; break; }
    case "term": generic.term = val; break;
    case "notes": generic.notes = val; break;
    default: break;
  }
}

function parseSpreadsheetRow(cells, headerMap) {
  const generic = emptyGeneric();
  const flags = {};
  const keys = headerMap || DEFAULT_COLUMN_ORDER;
  cells.forEach((raw, i) => {
    const key = keys[i];
    const val = String(raw || "").trim();
    if (!key || !val) return;
    assignGenericCell(generic, flags, key, val);
  });
  if (!generic.compType) {
    const guess = detectCompType(cells.join(" "));
    generic.compType = guess.value;
    flags.compType = { level: "soft", reason: "Type wasn't a column — guessed from the row text." };
  }
  return finalizeGenericRow(generic, flags, cells.join("\t"));
}

/** A tab-delimited pasted block -> one row per line. The first line is treated as a HEADER row
 * (and skipped as data) when at least two of its cells match a known column name; otherwise
 * every line is data, mapped positionally to `DEFAULT_COLUMN_ORDER`. */
export function parsePasteBlock(text) {
  const lines = splitPasteLines(text);
  if (!lines.length) return [];
  const rows = lines.map((l) => l.split("\t"));
  const firstRowMatches = rows[0].map(matchHeader);
  const matchCount = firstRowMatches.filter(Boolean).length;
  const headerMap = matchCount >= 2 ? firstRowMatches : null;
  const dataRows = headerMap ? rows.slice(1) : rows;
  return dataRows.map((cells) => parseSpreadsheetRow(cells, headerMap));
}

/** Top-level dispatcher: detects paste shape and returns `{ mode, rows }`, `rows` always
 * `[{ draft, cellFlags, raw }]`. */
export function parsePaste(text) {
  if (!String(text || "").trim()) return { mode: "empty", rows: [] };
  if (looksLikeSpreadsheetPaste(text)) return { mode: "spreadsheet", rows: parsePasteBlock(text) };
  return { mode: "prose", rows: splitPasteLines(text).map(parseProseLine) };
}

/** True if any cell in the row is a save-blocker. */
export function rowHasBlockingFlags(cellFlags) {
  return Object.values(cellFlags || {}).some((f) => f?.level === "blocking");
}
