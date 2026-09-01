/* compParse — comp entry parsing: paste text -> typed grid rows (B849232/NEW-1, corrected).
 *
 * THREE PASTE SHAPES, and detecting WHICH one a paste is is the whole point of this module
 * (owner correction, 2026-09-01 — the original spec said "one pasted line becomes one row,"
 * which is wrong about how comps actually arrive and produced 10/32 junk "Land" rows out of
 * a single ten-line lease abstract):
 *
 *   1. SPREADSHEET — a tab-delimited block (an Excel paste). Detected mechanically: any line
 *      containing a tab. Fills rows AND columns.
 *   2. SINGLE RECORD OVER MANY LINES — a lease/sale abstract, THE DOMINANT SHAPE brokers
 *      actually send: "TT: Modular Power Solutions" / "LL: Core5 Industrial Partners" /
 *      "20320 West Hardy Road" / "613,208 SF" / "126 months" / "$0.65/sf NNN" / etc — one deal,
 *      its facts scattered one-per-line, often with label:value prefixes (TT/LL/TI are standard
 *      industrial-brokerage shorthand for Tenant/Landlord/Tenant-Improvement-allowance). This is
 *      the DEFAULT when the shape is ambiguous — see `detectPasteShape` below for why.
 *   3. MANY RECORDS, ONE PER LINE — a real list, each line independently a complete comp
 *      ("3.2 AC land - $850k - Jan 2026").
 *
 * UNCERTAINTY (unchanged from the original spec): every parsed cell that required a guess
 * carries a verdict, never silently — `null` (confident), `"soft"`, or `"blocking"`. SOFT: the
 * guess IS the shown value (a k/m-suffixed number, an estimated date — visible, correctable).
 * BLOCKING: the shown value would be silently WRONG if the guess is wrong, because the risk
 * isn't visible in the value itself — the canonical case is a lease rate with no stated period.
 * This module never resolves a blocking guess itself — it only ever refuses to guess and says why.
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
const STREET_SUFFIX_RE = /\b(road|rd|street|st|avenue|ave|drive|dr|boulevard|blvd|lane|ln|way|highway|hwy|parkway|pkwy|court|ct|circle|cir|place|pl)\b/i;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function isoFrom(y, mo, d) {
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A number token, handling comma-stripped digits and a k/m/thousand/million suffix. The
 * suffix expansion is what makes a value SOFT — the expanded number is fully shown, so it's
 * always correctable by eyeballing it, never a save-blocker. Anchored to the WHOLE string. */
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

/** The first number in a string, UNANCHORED — for a labeled value that carries trailing prose
 * ("$13.00/sf from shell" -> 13). Never used where the whole-string anchor of
 * `parseMagnitudeNumber` is what's wanted (a bare cell value). */
function extractLeadingNumber(text) {
  const m = String(text || "").match(/([\d,]*\.?\d+)\s*(k|m|mm)?/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const suffix = m[2]?.toLowerCase();
  return { value: suffix ? n * NUM_SUFFIX[suffix] : n, soft: !!suffix };
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

// TI (tenant-improvement allowance) and a bare "$X/SF" figure are both lease-only vocabulary —
// a land or building-SALE deal is never quoted per-SF and never carries a TI allowance. Neither
// needs an accompanying /mo or /yr to count: TI's own dollar figure isn't a rate at all (so it
// has no period to state), and "$13.00/sf from shell" reads as a lease signal on its own.
const TI_MENTION_RE = /\bTI\b\s*(?:allowance)?\s*(?:of|:)?\s*\$/i;
const BARE_SF_RATE_RE = /\$\s*[\d,]*\.?\d+\s*\/\s*sf\b/i;

/** Best-effort comp type from wording — never blank, since every comp needs one, but flagged
 * soft whenever it was a guess rather than an explicit signal (lease words, or sale + a
 * building word). Defaults to "land", the app's own default, when nothing signals otherwise. */
export function detectCompType(text) {
  const t = String(text || "");
  if (LEASE_WORDS.test(t) || BASIS_RE.test(t) || BARE_SF_RATE_RE.test(t) || TI_MENTION_RE.test(t)) return { value: "lease", soft: false };
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

/** A bare "<N> months/years" line — the LEASE TERM. Deliberately refuses to fire on a line that
 * also says "free rent" (that's `findFreeRentMonths`'s field, not the term's — both match the
 * same "<N> months" shape and would otherwise double-book one line onto two fields). */
function findTermBare(text) {
  const t = String(text || "");
  if (/free\s*rent/i.test(t)) return null;
  const m = t.match(/\b(\d+)\s*[- ]?\s*(yrs?|years?|mo|mos|months?)\b/i);
  if (!m) return null;
  return /yr|year/i.test(m[2]) ? `${m[1]} yrs` : `${m[1]} mo`;
}

/** "6 months base free rent" / "free rent: 6 months" -> 6. A dedicated detector, not a reuse of
 * the term regex, because both match the identical "<N> months" shape. */
function findFreeRentMonths(text) {
  const m = String(text || "").match(/(\d+)\s*(?:mo|mos|months?)\s*(?:of\s*)?(?:base\s*)?free\s*rent|free\s*rent[^\d]{0,12}(\d+)\s*(?:mo|mos|months?)/i);
  if (!m) return null;
  const n = Number(m[1] || m[2]);
  return Number.isFinite(n) ? n : null;
}

/** "3.50% annual increases" -> 3.5. Deliberately requires BOTH a percent sign and an
 * escalation-flavored word nearby, so a stray "%" elsewhere (occupancy, LTV, whatever) doesn't
 * misfire. */
function findEscalationPct(text) {
  const m = String(text || "").match(/(\d+(?:\.\d+)?)\s*%[^.\n]{0,20}?(?:annual|escalat|increase|bump|step)/i);
  return m ? Number(m[1]) : null;
}

function findTi(text) {
  const m = String(text || "").match(/\bTI\b\s*(?:allowance)?\s*(?:of|:)?\s*\$?\s*([\d,]*\.?\d+)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** "20320 West Hardy Road - Building A" — a leading street number plus a recognizable street
 * suffix word. Used as a comp's Title, never fed into type/date/size detection (an address is
 * never evidence of anything else). */
function looksLikeAddressLine(text) {
  return /^\s*\d+\s+\S/.test(text) && STREET_SUFFIX_RE.test(text);
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
    ti: null, term: null, notes: null, freeRentMonths: null, escalationPct: null,
    commencementDate: null, commencementEstimated: false, commencementSourceLine: null,
  };
}

function genericHasAnything(g) {
  return !!(g.compDate || g.title || g.partyProvider || g.partyAcquirer || g.price != null ||
    g.rate != null || g.sizeValue != null || g.term || g.ti != null || g.freeRentMonths != null ||
    g.escalationPct != null || g.commencementDate);
}

/** One prose line (broker-email style) -> generic fields + pre-remap uncertainty flags. Used
 * for the MANY-RECORDS-ONE-PER-LINE shape, where each line is expected to be a complete,
 * independent comp. */
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

  g.term = findTermBare(text);
  g.freeRentMonths = findFreeRentMonths(text);
  g.ti = findTi(text);
  g.escalationPct = findEscalationPct(text);

  return { generic: g, flags };
}

function remapFlagKey(key, compType) {
  if (key === "price") return compType === "building_sale" ? "bldgPrice" : "landPrice";
  if (key === "sizeValue") return compType === "land" ? "landSizeValue" : compType === "building_sale" ? "bldgSizeSf" : "leaseSizeSf";
  if (key === "rate") return "leaseRate";
  return key;
}

/** The ONE place a lease row's period/basis ambiguity — and an estimated-commencement date —
 * are judged, shared by every shape, so "does this block" can never disagree between a pasted
 * line, a single-record abstract, or a spreadsheet cell. Remaps the generic-level flag keys
 * (price/sizeValue/rate) onto the type-specific field the grid actually renders. */
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
  // ⛔ B986096-HARDENING-8 (owner correction, reversing HARDENING-6's stand-in) — EXECUTION and
  // COMMENCEMENT are different facts about different moments, and a comp's Date column is USED:
  // comp_date drives every recency filter and sort, so quietly writing a commencement date into
  // it fabricates an execution date that never happened. On the owner's own real paste — a
  // commencement-only abstract, no execution date anywhere — the old stand-in put a date in the
  // FUTURE into comp_date, which would sort that comp ahead of every real one and land it inside
  // any "last 12 months" window until that date arrives. A commencement date lands ONLY in its
  // own field (`leaseCommencementDate`, flagged soft when the text marked it estimated).
  // compDate is NEVER backfilled from it — a row with no stated execution date stays with
  // compDate genuinely empty, and `validateComp`'s existing "Executed date is required." message
  // (surfaced in `ProblemsList`) is what asks for it, in words, rather than a silent guess.
  if (generic.commencementDate && generic.commencementEstimated) {
    mergeFlag(flags, "leaseCommencementDate", "soft", `Read as ESTIMATED from "${generic.commencementSourceLine}" — not a confirmed date.`);
  }

  return { draft: genericToDraft(generic), cellFlags: flags, raw };
}

/** Generic fields -> the string-keyed draft shape `comps.js`'s `draftToComp`/`insertComp`
 * expect. Only fields the caller actually has values for are set — an unset field stays at the
 * blank default, per the entry grid's own rule that an empty cell is just a cell. A commencement
 * date lands in `leaseCommencementDate` when one was found; it NEVER also fills `compDate` — see
 * `finalizeGenericRow`'s header for why that stand-in was removed. */
function genericToDraft(generic) {
  const d = {
    compType: "land", compDate: "", leaseCommencementDate: "", title: "", notes: "", teamId: null, projectId: null, anchor: null,
    partyProvider: "", partyAcquirer: "",
    landPrice: "", landSizeValue: "", landSizeUnit: "ac",
    bldgPrice: "", bldgSizeSf: "",
    leaseRate: "", leaseRatePeriod: "", leaseRateExpense: "", leaseTi: "", leaseTerm: "", leaseSizeSf: "",
    leaseFreeRentMonths: "", leaseEscalationPct: "",
  };
  d.compType = generic.compType || d.compType;
  if (generic.title) d.title = generic.title;
  if (generic.partyProvider) d.partyProvider = generic.partyProvider;
  if (generic.partyAcquirer) d.partyAcquirer = generic.partyAcquirer;

  if (generic.commencementDate) d.leaseCommencementDate = generic.commencementDate;
  // ⛔ HARDENING-8 — compDate is set ONLY from a real stated execution date, never backfilled
  // from commencementDate. See finalizeGenericRow's header for the full reasoning (a fabricated
  // FUTURE execution date corrupts every recency filter/sort that reads comp_date).
  if (generic.compDate) d.compDate = generic.compDate;
  d.notes = generic.notes || "";

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
    if (generic.freeRentMonths != null) d.leaseFreeRentMonths = String(generic.freeRentMonths);
    if (generic.escalationPct != null) d.leaseEscalationPct = String(generic.escalationPct);
  }
  return d;
}

/** One prose line -> `{ draft, cellFlags, raw }`, or `null` if the line contributed nothing
 * (never emit an entirely empty row). */
export function parseProseLine(line) {
  const { generic, flags } = extractGenericFromProse(line);
  if (!genericHasAnything(generic)) return null;
  return finalizeGenericRow(generic, flags, line);
}

/* ---- SINGLE RECORD OVER MANY LINES — the dominant shape: a lease/sale abstract ------------ */

// Label:value line prefixes, industrial-brokerage shorthand included (TT=Tenant, LL=Landlord,
// TI=Tenant Improvement allowance) — a small domain lexicon, not generic pattern matching.
const LABEL_PREFIX_RE = /^\s*(TT|LL|TI|Landlord|Tenant|Owner|Developer|Seller|Buyer|Rate|Term|Type|Date|Notes)\s*:\s*/i;
const LABEL_FIELD = {
  tt: "partyAcquirer", tenant: "partyAcquirer", buyer: "partyAcquirer",
  ll: "partyProvider", landlord: "partyProvider", owner: "partyProvider", developer: "partyProvider", seller: "partyProvider",
  ti: "ti", term: "term", rate: "rate", type: "compTypeLabel", date: "compDate", notes: "notes",
};
const LEASE_LABELS = new Set(["tt", "ll"]);

function hasKnownLabelPrefix(line) {
  return LABEL_PREFIX_RE.test(line);
}

/** Does this ONE line look like a complete, independent comp on its own (a price/rate AND a
 * size or date)? Used to detect the MANY-RECORDS-ONE-PER-LINE shape. */
function lineLooksLikeCompleteComp(line) {
  const hasMoney = !!(findPriceToken(line) || findRateToken(line));
  const hasSizeOrDate = !!(findSizeToken(line) || findDateToken(line));
  return hasMoney && hasSizeOrDate;
}

/** Detects which of the three paste shapes a block of text is. Spreadsheet (any tab) wins
 * outright. Otherwise: ANY recognized label:value line is strong, deliberate evidence of a
 * single multi-line record (a real per-line list essentially never starts a line with "TT:" /
 * "LL:" / etc) — checked BEFORE the completeness heuristic, not after, because it's the more
 * reliable signal. Failing that, if most lines independently look like a complete comp on
 * their own, it's a list. WHEN IN DOUBT, IT'S A SINGLE RECORD — the cheap failure direction: a
 * wrongly-split single record produces one row a user fixes in two seconds, where a wrongly-
 * merged list used to produce a wall of junk rows (the bug this function exists to close). */
export function detectPasteShape(text) {
  if (looksLikeSpreadsheetPaste(text)) return "spreadsheet";
  const lines = splitPasteLines(text);
  if (lines.length <= 1) return "single";
  if (lines.some(hasKnownLabelPrefix)) return "single";
  const completeCount = lines.filter(lineLooksLikeCompleteComp).length;
  if (completeCount / lines.length >= 0.6) return "multi";
  return "single";
}

function applyLabeledLine(generic, flags, sawLeaseLabel, label, value) {
  const key = LABEL_FIELD[label.toLowerCase()];
  const v = String(value || "").trim();
  if (!v) return;
  if (LEASE_LABELS.has(label.toLowerCase())) sawLeaseLabel.value = true;
  switch (key) {
    case "partyAcquirer": generic.partyAcquirer = v; break;
    case "partyProvider": generic.partyProvider = v; break;
    case "ti": { const n = extractLeadingNumber(v.replace(/^\$/, "").replace(/\/\s*sf/i, "")); if (n) generic.ti = n.value; break; }
    case "term": generic.term = v; break;
    case "rate": {
      const rt = findRateToken(v) || extractLeadingNumber(v.replace(/^\$/, "").replace(/\/\s*sf/i, ""));
      if (rt) { generic.rate = rt.value; generic.ratePeriod = generic.ratePeriod || detectPeriod(v); generic.rateBasis = generic.rateBasis || detectBasis(v); }
      break;
    }
    case "compTypeLabel": { const t = normalizeCompTypeToken(v); if (t) generic.compType = t; break; }
    case "compDate": { const d = findDateToken(v); if (d) { generic.compDate = d.iso; if (d.soft) mergeFlag(flags, "compDate", "soft", "Day wasn't given — defaulted to the 1st."); } break; }
    case "notes": generic.notes = generic.notes ? `${generic.notes}; ${v}` : v; break;
    default: break; // an unrecognized label still gets its VALUE run through content detectors below
  }
}

/** Runs EVERY detector against an unlabeled line, never stopping at the first match — a single
 * sentence routinely carries more than one fact ("roughly 3.2 AC, asking $850k" is a size AND
 * a price on ONE line), and stopping early silently dropped whichever fact wasn't checked
 * first. "First match wins" is still the rule PER FIELD (an earlier line's value is never
 * overwritten by a later one), just no longer per LINE. Anything the line contains that no
 * detector recognizes is appended to notes rather than silently dropped. */
function extractUnlabeledLine(generic, flags, line) {
  let matchedAnything = false;

  if (!generic.title && looksLikeAddressLine(line)) { generic.title = line.trim(); matchedAnything = true; }

  if (generic.freeRentMonths == null) {
    const freeRent = findFreeRentMonths(line);
    if (freeRent != null) { generic.freeRentMonths = freeRent; matchedAnything = true; }
  }

  if (generic.escalationPct == null) {
    const escPct = findEscalationPct(line);
    if (escPct != null) { generic.escalationPct = escPct; matchedAnything = true; }
  }

  const isCommencementLine = /commenc/i.test(line);
  if (isCommencementLine && generic.commencementDate == null) {
    const d = findDateToken(line);
    if (d) {
      generic.commencementDate = d.iso;
      generic.commencementEstimated = /estimat/i.test(line);
      generic.commencementSourceLine = line.trim();
      matchedAnything = true;
    }
  }

  if (generic.rate == null) {
    const rateTok = findRateToken(line);
    if (rateTok) {
      generic.rate = rateTok.value;
      if (rateTok.soft) mergeFlag(flags, "rate", "soft", "Had a k/m suffix — check the expanded value.");
      generic.ratePeriod = generic.ratePeriod || detectPeriod(line);
      generic.rateBasis = generic.rateBasis || detectBasis(line);
      matchedAnything = true;
    }
  }

  if (generic.sizeValue == null) {
    const sizeTok = findSizeToken(line);
    if (sizeTok) {
      generic.sizeValue = sizeTok.value;
      generic.sizeUnit = sizeTok.unit;
      if (sizeTok.soft) mergeFlag(flags, "sizeValue", "soft", "Had a k/m suffix — check the expanded value.");
      matchedAnything = true;
    }
  }

  if (generic.ti == null) {
    const tiVal = findTi(line);
    if (tiVal != null) { generic.ti = tiVal; matchedAnything = true; }
  }

  // Never lets a commencement line's date land in compDate at all (HARDENING-8) — the two are
  // different facts about different moments, and compDate drives recency filters/sorts, so a
  // commencement date leaking into it fabricates an execution date that never happened.
  if (!isCommencementLine && generic.compDate == null) {
    const dateTok = findDateToken(line);
    if (dateTok) {
      generic.compDate = dateTok.iso;
      if (dateTok.soft) mergeFlag(flags, "compDate", "soft", "Day of month wasn't given — defaulted to the 1st.");
      matchedAnything = true;
    }
  }

  if (generic.price == null && generic.rate == null) {
    const priceTok = findPriceToken(line);
    if (priceTok) {
      generic.price = priceTok.value;
      if (priceTok.soft) mergeFlag(flags, "price", "soft", "Had a k/m suffix — check the expanded value.");
      matchedAnything = true;
    }
  }

  if (!generic.term) {
    const term = findTermBare(line);
    if (term) { generic.term = term; matchedAnything = true; }
  }

  // Nothing recognized on this line — never silently dropped: appended to notes so it's still
  // visible against the row, matching "a value the user pasted must never vanish without a word."
  if (!matchedAnything) {
    const trimmed = line.trim();
    if (trimmed) generic.notes = generic.notes ? `${generic.notes}; ${trimmed}` : trimmed;
  }
}

/** A whole block of text -> ONE record (the single-multi-line-record shape). Returns `null` if
 * the block contributed nothing at all. Every line is either a recognized label:value pair or
 * run through the same content detectors the per-line parser uses, merged onto ONE generic
 * record (first match wins per field; a labeled line always takes priority since it's the
 * higher-confidence signal). */
export function parseSingleRecord(text) {
  const lines = splitPasteLines(text);
  const generic = emptyGeneric();
  const flags = {};
  const sawLeaseLabel = { value: false };

  for (const line of lines) {
    const m = line.match(LABEL_PREFIX_RE);
    if (m) {
      applyLabeledLine(generic, flags, sawLeaseLabel, m[1], line.slice(m[0].length));
    } else {
      extractUnlabeledLine(generic, flags, line);
    }
  }

  if (!generic.compType) {
    if (sawLeaseLabel.value) {
      generic.compType = "lease";
    } else {
      const guess = detectCompType(lines.join(" "));
      generic.compType = guess.value;
      if (guess.soft) flags.compType = { level: "soft", reason: "Type guessed from the wording — check it." };
    }
  }

  if (!genericHasAnything(generic)) return null;
  return finalizeGenericRow(generic, flags, text);
}

/* ---- spreadsheet / Excel block paste ------------------------------------------------------ */

export function looksLikeSpreadsheetPaste(text) {
  return String(text || "").split(/\r?\n/).some((l) => l.includes("\t"));
}

export function splitPasteLines(text) {
  return String(text || "").split(/\r?\n/).map((l) => l.replace(/\r$/, "")).filter((l) => l.trim() !== "");
}

// Column header aliases (case-insensitive, exact cell match) -> the generic field they fill.
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
 * every line is data, mapped positionally to `DEFAULT_COLUMN_ORDER`. Rows that end up with
 * nothing at all are dropped — never emitted empty. */
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

/** Top-level dispatcher: detects paste SHAPE (not just spreadsheet-vs-not) and returns
 * `{ mode, rows }` — `mode` is `"empty" | "spreadsheet" | "single" | "multi"`, `rows` always
 * `[{ draft, cellFlags, raw }]` with no entirely-empty rows. */
export function parsePaste(text) {
  if (!String(text || "").trim()) return { mode: "empty", rows: [] };
  const shape = detectPasteShape(text);
  if (shape === "spreadsheet") return { mode: "spreadsheet", rows: parsePasteBlock(text) };
  if (shape === "single") {
    const row = parseSingleRecord(text);
    return { mode: "single", rows: row ? [row] : [] };
  }
  return { mode: "multi", rows: splitPasteLines(text).map(parseProseLine).filter(Boolean) };
}

/** True if any cell in the row is a save-blocker. */
export function rowHasBlockingFlags(cellFlags) {
  return Object.values(cellFlags || {}).some((f) => f?.level === "blocking");
}
