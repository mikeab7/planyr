/* compParse — comp entry parsing: paste text -> typed grid rows (B849232/NEW-1; B986096 recurrence
 * ×9, 2026-09-01, owner report — read this header before touching a detector).
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
 *
 * ⛔ B986096 ×9 (owner report, 2026-09-01) — THE SCAVENGER REWRITE. Michael pasted
 * ".56/SF , 12 TI, 3% bumps" — three real facts — and got one bare "Land" row with nothing
 * filled in. Two separate defects, both closed here:
 *
 * (A) ONE UNRECOGNIZED TOKEN MUST NEVER SUPPRESS A RECOGNIZED ONE, AND A ROW WITH NO TYPE
 *     SIGNAL MUST NEVER DEFAULT TO LAND. The old code already avoided a hard "abort the whole
 *     parse" — `extractUnlabeledLine` always ran every detector — but `detectCompType` had a
 *     bare `return { value: "land", soft: true }` when nothing signalled a type, and
 *     `genericToDraft` only ever writes economic fields into the fields the RESOLVED type owns
 *     (`landPrice` for land, `leaseRate` for lease, ...). So a rate/TI/escalation that WAS
 *     correctly extracted was silently thrown away the moment the type guess landed on the
 *     wrong bucket — a defaulted "Land" row has nowhere to put a lease rate. `detectCompType`
 *     now returns `{ value: null, soft: true }` when nothing signals a type — never a guessed
 *     "land" — and `inferTypeFromCapturedFields` gives the type resolver ONE more chance,
 *     reading what was actually extracted (a rate/TI/free-rent means lease; a cap rate or NOI
 *     means building sale; an acre-denominated size means land) before finally leaving `compType`
 *     genuinely BLANK rather than guessed. Every unclaimed fragment left over after every
 *     detector has run is preserved verbatim in `notes` (never dropped) — see `extractUnlabeledLine`.
 * (B) EVERY LABELLED FIELD SCANS BOTH DIRECTIONS. "TI $12" and "12 TI" must both read as TI=12;
 *     the old detectors only ever matched label-then-value. `scanField` below tries a
 *     value-then-label pattern and a label-then-value pattern and returns whichever matches.
 * (C) MONEY DOES NOT REQUIRE A LITERAL "$". ".56/SF" is a rate; "65 cents" is $0.65; a bare
 *     decimal with no unit at all is read by MAGNITUDE (0.10–5.00 defaults to a monthly $/SF
 *     rate, the industry's own convention) only when nothing else claims it and nothing else in
 *     the line contradicts it — see `findRateToken`. The parser never invents a RATE PERIOD from
 *     magnitude alone; that stays a `blocking` cell exactly as before.
 *
 * ⛔ B1063904 (owner report, 2026-09-02) — DATA CORRUPTION: "5 AC land sale" + ".56/SF , 12 TI, 3%
 * bumps" merged into ONE hybrid row that kept line 1's Size (5) and let line 2's type flip the
 * row to Lease, which has no acre unit — 5 ACRES silently became 5 SQUARE FEET, wrong by a factor
 * of 43,560, invisible because "5" still looks plausible. MERGE SAFETY closes this: `parsePaste`
 * parses every line of a would-be single record fully independently first
 * (`detectFieldCollisions`) and refuses to merge — falling back to one row per line, `mode:
 * "split"` — the moment two lines disagree on the same field. Type and Unit are never mergeable on
 * a collision, full stop, because they change the meaning of every other number on the row; every
 * other field currently gets the same treatment. Complementary lines (disjoint fields — an address
 * on one line, a rate on the next) are unaffected and still merge exactly as before. See
 * `buildLineGeneric`/`detectFieldCollisions` below.
 */

const NUM_SUFFIX = { k: 1e3, m: 1e6, mm: 1e6, thousand: 1e3, million: 1e6 };

// A flat ceiling on the RAW quoted lease rate, regardless of period — $200/SF is already far
// above any realistic industrial/office/retail figure whether quoted monthly ($2,400/yr
// equivalent) or annually, so one number catches a missing decimal point or a unit mixup either
// way without having to know the period first (SEVERITY-1 finding, live report: "999999999/SF/yr"
// saved with no ceiling at all).
const RATE_IMPLAUSIBLE_CEILING = 200;

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const LEASE_WORDS = /\b(lease|leased|leasing|tenant|landlord|rent(?:ed|al)?|abat[a-z]*|term|RCD|LCD)\b/i;
// HARDENING-11 (owner correction, 2026-09-02) — the gross-family list Michael named explicitly:
// gross, full service, FS, IG, industrial gross, MG, modified gross, base year. Any of these
// still WINS over the NNN default (see finalizeGenericRow's own basis-default logic below) —
// this module never silently drops an explicit basis.
const BASIS_NNN_RE = /\b(nnn|tri+p+le\s*net|nn|abs(?:olute)?\s*net)\b/i;
const BASIS_GROSS_RE = /\b(gross|full\s*service|fs|ig|industrial\s*gross|mg|modified\s*gross|base\s*year)\b/i;
const BASIS_RE = new RegExp(`(?:${BASIS_NNN_RE.source})|(?:${BASIS_GROSS_RE.source})`, "i");
const SALE_WORDS = /\b(sold|sale|purchased?|closed|buyer|seller|purchaser|grantor|grantee)\b/i;
const BUILDING_WORDS = /\b(building|warehouse|industrial|office|flex|shell|facility)\b/i;
const LAND_WORDS = /\b(land|acres?|\bac\b|\blot\b|tract|pad\s*site|raw\s*land|dirt|unimproved)\b/i;
const PERIOD_RE = /(\/\s*mo\b|\/\s*month\b|per\s+month\b|\bmonthly\b|\/\s*yr\b|\/\s*year\b|per\s+year\b|per\s+annum\b|\bannual(?:ly)?\b|\byearly\b|\bpa\b)/i;
const STREET_SUFFIX_RE = /\b(road|rd|street|st|avenue|ave|drive|dr|boulevard|blvd|lane|ln|way|highway|hwy|parkway|pkwy|court|ct|circle|cir|place|pl)\b/i;
// A bare "$X/SF" or "X/SF" (no $ required — DEFECT C) and a bare TI mention are both lease-only
// vocabulary — neither needs an accompanying /mo or /yr, and neither needs a dollar sign.
const BARE_SF_RATE_RE = /[\d.]+\s*\/\s*sf\b/i;
const TI_MENTION_RE = /\bTIA?\b/i;
const CAP_WORD_RE = /(?:going[- ]in\s+cap(?:\s*rate)?|cap\s*rate|\bcap\b)/i;
const NOI_WORD_RE = /\bNOI\b/i;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function isoFrom(y, mo, d) {
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Pivot-at-50 2-digit year expansion, the one convention every date reader in this app shares
// (mirrors compDates.js's fullYear — kept as its own copy since that module isn't Node-safe-free
// of this one and duplicating four lines is cheaper than a cross-import for a leaf this small).
function fullYear(yStr) {
  if (yStr.length >= 4) return Number(yStr);
  const n = Number(yStr);
  return n > 50 ? 1900 + n : 2000 + n;
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

/** Find a date anywhere in free text: ISO, M/D/YYYY (US month-first), "Month D, YYYY" (any of
 * space/dash between the parts), a bare "Month YYYY" or "Month-YY" (no day — defaults to the
 * 1st, flagged soft), a bare "M/YY" (no day, same treatment), a calendar quarter ("Q2 2027" ->
 * the quarter's first month) or "mid-YYYY" (-> July) — the last two explicitly APPROXIMATE, so
 * both come back soft with a reason naming why, never silently defaulted to a day the same way
 * a merely-missing day is. */
function findDateTokenRaw(text) {
  const s = String(text || "");
  let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) { const iso = isoFrom(+m[1], +m[2], +m[3]); return iso ? { iso, soft: false, match: m } : null; }
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) {
    const [, mo, da, yrRaw] = m;
    const iso = isoFrom(fullYear(yrRaw), +mo, +da);
    return iso ? { iso, soft: false, match: m } : null;
  }
  m = s.match(/\b([A-Za-z]+)\.?[\s-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s-]+(\d{2,4})\b/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const iso = isoFrom(fullYear(m[3]), MONTHS[m[1].toLowerCase()], +m[2]);
    return iso ? { iso, soft: false, match: m } : null;
  }
  m = s.match(/\b([A-Za-z]+)\.?[\s-](\d{2,4})\b/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const iso = isoFrom(fullYear(m[2]), MONTHS[m[1].toLowerCase()], 1);
    return iso ? { iso, soft: true, match: m } : null;
  }
  m = s.match(/\b(\d{1,2})\/(\d{2,4})\b(?!\/)/);
  if (m) {
    const iso = isoFrom(fullYear(m[2]), +m[1], 1);
    return iso ? { iso, soft: true, match: m } : null;
  }
  m = s.match(/\bQ([1-4])\s*(\d{4})\b/i);
  if (m) {
    const iso = isoFrom(+m[2], (Number(m[1]) - 1) * 3 + 1, 1);
    return iso ? { iso, soft: true, reason: `Read as an approximate quarter from "${m[0]}" — not an exact date.`, match: m } : null;
  }
  m = s.match(/\bmid[\s-](\d{4})\b/i);
  if (m) {
    const iso = isoFrom(+m[1], 7, 1);
    return iso ? { iso, soft: true, reason: `Read as an approximate mid-year date from "${m[0]}" — not an exact date.`, match: m } : null;
  }
  return null;
}

/** Find a date anywhere in free text: ISO, M/D/YYYY (US month-first), "Month D, YYYY" (any of
 * space/dash between the parts), a bare "Month YYYY" or "Month-YY" (no day — defaults to the
 * 1st, flagged soft), a bare "M/YY" (no day, same treatment), a calendar quarter ("Q2 2027" ->
 * the quarter's first month) or "mid-YYYY" (-> July) — the last two explicitly APPROXIMATE, so
 * both come back soft with a reason naming why, never silently defaulted to a day the same way
 * a merely-missing day is. Public shape is `{ iso, soft, reason? }` only — the internal match
 * span callers need to blank a claimed date out of a working line lives in
 * `findDateTokenRaw`. */
export function findDateToken(text) {
  const hit = findDateTokenRaw(text);
  if (!hit) return null;
  const { match: _match, ...rest } = hit;
  return rest;
}

function detectPeriod(text) {
  const m = String(text || "").match(PERIOD_RE);
  if (!m) return null;
  const t = m[1].toLowerCase();
  return t.includes("mo") ? "monthly" : "annual";
}

function detectBasis(text) {
  const t = String(text || "");
  if (BASIS_NNN_RE.test(t)) return "nnn";
  if (BASIS_GROSS_RE.test(t)) return "gross";
  return null;
}

/** Best-effort comp type from wording — NEVER blank-defaults to "land" any more (B986096 ×9):
 * returns `{ value: null, soft: true }` when nothing signals a type at all, so a caller with
 * more information (what fields were actually extracted — `inferTypeFromCapturedFields`) gets
 * one more chance before the row is left genuinely untyped. Flagged soft whenever it was a
 * guess rather than an explicit signal (lease words, or sale + a building word). */
export function detectCompType(text) {
  const t = String(text || "");
  if (LEASE_WORDS.test(t) || BASIS_RE.test(t) || BARE_SF_RATE_RE.test(t) || TI_MENTION_RE.test(t)) return { value: "lease", soft: false };
  const sale = SALE_WORDS.test(t);
  const building = BUILDING_WORDS.test(t);
  const capOrNoi = CAP_WORD_RE.test(t) || NOI_WORD_RE.test(t);
  if (sale && building) return { value: "building_sale", soft: false };
  if (LAND_WORDS.test(t)) return { value: "land", soft: false };
  if (sale || capOrNoi) return { value: "building_sale", soft: true };
  return { value: null, soft: true };
}

/** The type resolver's LAST resort, tried only once wording has said nothing at all: reads what
 * was actually captured rather than re-scanning text for keywords. Rate/TI/free-rent is
 * lease-only vocabulary; a cap rate or NOI is sale-only; an acre-denominated size is land; a
 * price alongside a non-acre size reads as a building sale (TYPE INFERENCE table, B986096 ×9).
 * Returns null — never a type — when even the captured fields don't say. */
function inferTypeFromCapturedFields(g) {
  if (g.rate != null || g.ti != null || g.freeRentMonths != null) return "lease";
  if (g.capRate != null || g.noi != null) return "building_sale";
  if (g.sizeUnit === "ac") return "land";
  if (g.price != null && g.sizeValue != null && g.sizeUnit !== "ac") return "building_sale";
  return null;
}

/* ---- "claim and blank" — the scavenger mechanism (DEFECT A) ------------------------------
 * Highly specific fields (TI, escalation, cap, NOI, free rent, term) claim their own tokens
 * FIRST and their matched span is blanked out of a working copy of the line, so the more
 * generic/ambiguous detectors that run afterward (rate, price, size) can never re-claim or
 * misread a token another field already owns. Whatever is left over after every detector has
 * run — real words, not just punctuation — is preserved verbatim rather than dropped. */

function blank(working, m) {
  if (!m) return working;
  const start = m.index;
  const end = start + m[0].length;
  return working.slice(0, start) + " ".repeat(end - start) + working.slice(end);
}

/** Try a value-then-label pattern, then a label-then-value pattern (DEFECT B — both directions,
 * always). Returns `{ value, working }` (working = the input with the match blanked) or null. */
function scanField(text, valueThenLabelRe, labelThenValueRe, toValue) {
  let m = text.match(valueThenLabelRe);
  if (m) return { value: toValue(m), working: blank(text, m) };
  m = text.match(labelThenValueRe);
  if (m) return { value: toValue(m), working: blank(text, m) };
  return null;
}

/** True when a captured numeric string mixes decimal and thousands separators ambiguously — a
 * comma-group that isn't exactly 3 digits (e.g. "234,56") is almost certainly a EUROPEAN decimal
 * ("234,56" = 234.56) misread as US thousands grouping, corrupting the value by orders of
 * magnitude while looking perfectly plausible (SEVERITY-1 live report: "1.234,56" read as
 * 23,456 — ~19,000x too high, with the malformed reading fully believable on its own). Never
 * guessed either way — the caller refuses the number rather than picking a reading. */
function hasAmbiguousGrouping(rawNumStr) {
  const s = String(rawNumStr || "");
  if (!s.includes(",")) return false;
  // Validate only the INTEGER portion's comma groups — a genuine US-formatted number can carry a
  // decimal tail after its last group ("4,150,000.00"), which is not itself a grouping digit and
  // must not be checked as one.
  const dot = s.indexOf(".");
  const intPart = dot === -1 ? s : s.slice(0, dot);
  const groups = intPart.split(",");
  for (let i = 1; i < groups.length; i++) {
    if (!/^\d{3}$/.test(groups[i])) return true;
  }
  return false;
}

/** True when the numeric token matched at `index` within `text` is immediately (TIGHTLY, no
 * whitespace) preceded by a bare "-" its own regex doesn't capture — a DROPPED negative sign
 * (SEVERITY-1 live report: "-5.00/SF/yr" silently read as $5). Deliberately does NOT skip
 * whitespace: this corpus's own convention for separating clauses is a spaced dash
 * ("3.2 AC land - $850k - Jan 2026"), which is not a sign and must never be read as one — only a
 * "-" glued directly onto the digits is. `text` is always position-aligned with the record's
 * original line — `blank()` only ever replaces an already-claimed span with spaces of equal
 * length, never removes characters — so an index into a partially-blanked working copy is still
 * a valid index into the original text. Also excludes a "-" sandwiched between two digits (a
 * date or a range, not a sign). */
function precededByDroppedMinus(text, index) {
  if (index <= 0 || text[index - 1] !== "-") return false;
  return !/\d/.test(text[index - 2] || "");
}

function moneyVal(rawNum, rawSuffix) {
  if (hasAmbiguousGrouping(rawNum)) return { value: null, soft: false, invalid: true };
  const n = Number(String(rawNum).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const suffix = rawSuffix?.toLowerCase();
  const mult = suffix ? NUM_SUFFIX[suffix] : 1;
  // Round off float dust (4.15 * 1e6 is 4150000.0000000005 in IEEE 754) — every dollar figure
  // here is currency, never needs sub-cent precision.
  return { value: Math.round(n * mult * 100) / 100, soft: !!suffix };
}

/** Wraps a successful money-regex match with the shared negative-sign and ambiguous-grouping
 * checks, so every rate/price call site gets both for free rather than each reimplementing them. */
function wrapMoneyMatch(t, m) {
  const mv = moneyVal(m[1], m[2]);
  return { ...mv, working: blank(t, m), negative: precededByDroppedMinus(t, m.index), rawMatch: m[0] };
}

/* ---- TI (tenant-improvement allowance) ----------------------------------------------------- */

const TI_LABEL = /(?:TI\s*\/\s*LL\s*work|TIA|TI)\b/i;
const TI_VALUE_THEN_LABEL_RE = new RegExp(`\\$?\\s*([\\d,]*\\.?\\d+)\\s*(?:psf\\b|\\/\\s*sf\\b)?\\s*(?:${TI_LABEL.source})`, "i");
const TI_LABEL_THEN_VALUE_RE = new RegExp(`(?:${TI_LABEL.source})\\s*(?:allowance)?\\s*(?:of|:)?\\s*\\$?\\s*([\\d,]*\\.?\\d+)`, "i");

/** "TI: $13.00/sf" / "$13 TI" / "13 TI" / "13 TIA" / "TI allowance of $13.00/SF" / "$13.00 psf
 * TI" / "TI/LL work $13" — both directions. Returns `{ value, working }` or null. A bare
 * "turnkey" mention with no dollar figure is a real fact with nothing numeric to store — the
 * caller checks for it separately via `findTurnkeyMention`. */
function findTiToken(text) {
  const hit = scanField(text, TI_VALUE_THEN_LABEL_RE, TI_LABEL_THEN_VALUE_RE, (m) => {
    const n = Number(m[1].replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  });
  return hit && hit.value != null ? hit : null;
}

function findTurnkeyMention(text) {
  return /\bturnkey\b/i.test(text);
}

/* ---- escalation (percentage AND dollar-denominated) ---------------------------------------- */

const ESCAL_WORD = /(?:annual|escalat[a-z]*|increase[a-z]*|bumps?|steps?|\bann\b)/i;
// Consumes a whole RUN of escalation-flavored words ("annual increases", "annual escalations of")
// rather than stopping at the first one, so a trailing word like "increases" doesn't leak into
// the unrecognized-fragment leftover after "annual" alone has already claimed the match.
const ESCAL_WORD_RUN = new RegExp(`(?:${ESCAL_WORD.source})(?:\\s+(?:of\\s+)?(?:${ESCAL_WORD.source}))*`, "i");
const ESCAL_PCT_VALUE_THEN_LABEL_RE = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*%[^.\\n]{0,20}?(?:${ESCAL_WORD_RUN.source}|\\/\\s*yr\\b|\\/\\s*year\\b|per\\s+year\\b)`, "i");
const ESCAL_PCT_LABEL_THEN_VALUE_RE = new RegExp(`(?:${ESCAL_WORD_RUN.source})[^.\\n]{0,20}?(\\d+(?:\\.\\d+)?)\\s*%`, "i");
// A bare percentage with no escalation word nearby and no "cap" word nearby is still read as an
// escalation — the residual default per the DISAMBIGUATION rule (0–20% -> escalation or cap;
// "cap" is the more specific, narrower claim, so it wins when both are absent this is what's left).
const BARE_PCT_RE = /(\d+(?:\.\d+)?)\s*%/;
const DOLLAR_ESCAL_RE = /\$\s*([\d,]*\.?\d+)\s*(?:\/\s*sf)?\s*\/\s*(mo|month|yr|year)\b[^.\n]{0,20}?(?:bumps?|escalat[a-z]*|increase[a-z]*|steps?)/i;

/** Percentage escalation, both directions, plus the bare-percentage residual default. Returns
 * `{ value, working }` (value in raw percentage points, e.g. 3.5) or null. */
function findEscalationPct(text) {
  const hit = scanField(text, ESCAL_PCT_VALUE_THEN_LABEL_RE, ESCAL_PCT_LABEL_THEN_VALUE_RE, (m) => Number(m[1]));
  if (hit) return hit;
  if (CAP_WORD_RE.test(text)) return null; // let the cap-rate detector own this percentage instead
  const m = text.match(BARE_PCT_RE);
  return m ? { value: Number(m[1]), working: blank(text, m) } : null;
}

/** "$0.02/yr bumps" — a DOLLAR-denominated escalation, not a percentage. There is no numeric
 * field for this in the schema (`leaseEscalationPct` is a percentage only), so this returns the
 * descriptive TEXT for the caller to fold into notes rather than fabricating a percentage — see
 * the file header's DEFECT A: a recognized fact with nowhere structured to live still must not
 * vanish. Returns `{ note, working }` or null. */
function findDollarEscalation(text) {
  const m = text.match(DOLLAR_ESCAL_RE);
  if (!m) return null;
  const period = /mo|month/i.test(m[2]) ? "mo" : "yr";
  return { note: `Escalation: $${m[1]}/SF/${period} (a dollar step, not a percent)`, working: blank(text, m) };
}

function findCpiMention(text) {
  return /\bCPI\b/i.test(text);
}

/* ---- cap rate + NOI (building sale only) ---------------------------------------------------- */

const CAP_VALUE_THEN_LABEL_RE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*%?\\s*(?:${CAP_WORD_RE.source})`, "i");
const CAP_LABEL_THEN_VALUE_RE = new RegExp(`(?:${CAP_WORD_RE.source})\\s*(?:of|:)?\\s*(\\d+(?:\\.\\d+)?)\\s*%?`, "i");

/** Cap rate, both directions — "6.25% cap" / "cap: 6.25" / "6.25 cap" / "going-in cap of
 * 6.25%". Returns `{ value, working }` with `value` a raw PERCENTAGE (6.25) — the caller
 * converts to the schema's stored fraction (0.0625) at the draft boundary, same as the sheet's
 * own `bldgCapRate` column does (compSheetColumns.js). */
function findCapRateToken(text) {
  return scanField(text, CAP_VALUE_THEN_LABEL_RE, CAP_LABEL_THEN_VALUE_RE, (m) => Number(m[1]));
}

const NOI_VALUE_THEN_LABEL_RE = /\$?\s*([\d,]*\.?\d+)\s*(k|m|mm)?\s*(?:of\s*)?NOI\b/i;
const NOI_LABEL_THEN_VALUE_RE = /\bNOI\b\s*(?:of|:)?\s*\$?\s*([\d,]*\.?\d+)\s*(k|m|mm)?/i;

/** "NOI $2,600,000" / "NOI: 2.6M" — both directions. Returns `{ value, soft, working }`. */
function findNoiToken(text) {
  return scanField(text, NOI_VALUE_THEN_LABEL_RE, NOI_LABEL_THEN_VALUE_RE, (m) => moneyVal(m[1], m[2]).value);
}

/* ---- free rent -------------------------------------------------------------------------------
 * "6 months free" / "6 mo free rent" / "6 free" / "6mo FR" / "six months free" /
 * "6 months abated" / "6 mo abatement" / "free rent: 6" / "6 months base free rent" /
 * "abatement of 6 months" — both directions, several synonyms (free/free rent/abated/
 * abatement/FR), the unit word itself optional either side. */

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const FREE_WORD = /(?:free(?:\s*rent)?|abated|abatement|\bFR\b)/i;
const FREE_RENT_VALUE_THEN_LABEL_RE = new RegExp(
  `\\b(\\d+(?:\\.\\d+)?)\\s*(?:mo|mos|months?)?\\s*(?:of\\s*)?(?:base\\s*)?(?:${FREE_WORD.source})`, "i");
const FREE_RENT_LABEL_THEN_VALUE_RE = new RegExp(
  `(?:${FREE_WORD.source})\\s*(?:of\\s*|:\\s*)?(\\d+(?:\\.\\d+)?)\\s*(?:mo|mos|months?)?`, "i");
const FREE_RENT_WORD_NUM_RE = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*months?\s*free/i;

function findFreeRentMonths(text) {
  const wordM = text.match(FREE_RENT_WORD_NUM_RE);
  if (wordM) return { value: WORD_NUM[wordM[1].toLowerCase()], working: blank(text, wordM) };
  return scanField(text, FREE_RENT_VALUE_THEN_LABEL_RE, FREE_RENT_LABEL_THEN_VALUE_RE, (m) => Number(m[1]));
}

/* ---- term ------------------------------------------------------------------------------------
 * "126 months" / "126 mo" / "126 mos" / "126mo" / "126-month" / "10.5 yr" / "10.5 years" /
 * "10 yr 6 mo" / "10-year term" — a combined "N yr M mo" normalizes to total months, matching
 * the app's own "126 mo" convention (`parseLeaseTermYears` reads this text back later). */

const TERM_COMBINED_RE = /\b(\d+)\s*(?:yrs?|years?)\s+(\d+)\s*(?:mo|mos|months?)\b/i;
// A dollar-prefixed number is never a term duration ("$6.72 yr" is a RATE, not a 6.72-year
// term) — excluded so it's left for the rate detector instead. `(?<![\d.])` on its own is not
// enough: without it, the "$" exclusion at the true start of "6.72" just pushes the regex to
// retry from "72" (right after the decimal point, which is itself a genuine \b), matching a
// bogus "72-year term" out of the tail of a dollar figure — both lookbehinds are needed together.
const TERM_SINGLE_RE = /(?<![\d.])(?<!\$\s{0,3})\b(\d+(?:\.\d+)?)\s*[- ]?\s*(yrs?|years?|mo|mos|months?)\b/i;

/** A bare duration — the LEASE TERM. Deliberately refuses to fire on a line that also says
 * "free rent" (that shape belongs to `findFreeRentMonths`, not the term's — both match "<N>
 * months" and would otherwise double-book one line onto two fields). */
function findTermBare(text) {
  const t = String(text || "");
  if (/free\s*rent/i.test(t)) return null;
  const combined = t.match(TERM_COMBINED_RE);
  if (combined) {
    const months = Number(combined[1]) * 12 + Number(combined[2]);
    return { text: `${months} mo`, working: blank(t, combined) };
  }
  const m = t.match(TERM_SINGLE_RE);
  // A term under one unit is never real ("0.65 mo" is a rate wearing the same "<N> mo" shape,
  // never a two-thirds-of-a-month lease) — leave it for the rate detector instead.
  if (!m || Number(m[1]) < 1) return null;
  const text2 = /yr|year/i.test(m[2]) ? `${m[1]} yrs` : `${m[1]} mo`;
  return { text: text2, working: blank(t, m) };
}

/* ---- size ------------------------------------------------------------------------------------
 * 613,208 SF | 613208 sf | 613k sf | 613.2k SF | 2.88M SF | 66.17 ac | 66 acres | 66.17ac */

// A dollar-prefixed number is never a size ("$0.65 sf/mo" is a RATE, not a 0.65 SF parcel) —
// both lookbehinds are needed together, same reasoning as TERM_SINGLE_RE's above: the $-only
// exclusion alone just pushes a match to retry from mid-number, right after a decimal point.
const SIZE_RE = /(?<![\d.])(?<!\$\s{0,3})\b([\d,]*\.?\d+)\s*(k|m|mm)?\s*(ac|acres?|sf|square\s*feet)\b/i;

function findSizeToken(text) {
  const t = String(text || "");
  const m = t.match(SIZE_RE);
  if (!m) return null;
  if (hasAmbiguousGrouping(m[1])) return { value: null, unit: null, invalid: true, working: blank(t, m), rawMatch: m[0] };
  let n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const suffix = m[2]?.toLowerCase();
  const soft = !!suffix;
  if (suffix) n *= NUM_SUFFIX[suffix];
  const unit = m[3].toLowerCase().startsWith("ac") ? "ac" : "sf";
  return { value: n, unit, soft, working: blank(t, m), negative: precededByDroppedMinus(t, m.index), rawMatch: m[0] };
}

/* ---- rate + price (the ambiguous, low-priority detectors — run LAST) ------------------------ */

// "¢" is not a \w character, so a trailing \b after it never matches (no word/non-word
// transition between two non-word characters) — each alternative carries its own boundary.
const CENTS_RE = /\b(\d+(?:\.\d+)?)\s*(?:cents?\b|¢|c\b)/i;
// Explicit "/SF" or "psf" marker — $ optional (DEFECT C). Unambiguous: nothing but a rate is
// ever quoted this way.
// The unit is usually "/SF" (slash-prefixed) or "psf", but also shows up as a bare "sf"
// directly chained into a following period ("$0.65 sf/mo") — that compound shape is unambiguous
// enough to accept without requiring its own leading slash.
// B986096-HARDENING-23 (owner live-report) — the "/\s*sf\b" alternative used to stop matching
// right after "SF", so ".56/SF/mo" only consumed ".56/SF" — regex alternation tries alternatives
// in order and takes the first that matches, not the longest, so this one always won before the
// engine could ever reach the "sf\s*\/\s*(?:mo|...)" alternative below it. The leftover "/mo"
// fell through as an unrecognized fragment and landed in Notes. detectPeriod (the caller, above)
// reads the ORIGINAL line independently, never this regex's own capture, so consuming the period
// suffix here loses no information — it only stops it leaking downstream.
const RATE_SF_RE = /\$?\s*([\d,]*\.?\d+)\s*(k|m)?\s*(?:\/\s*sf\b(?:\s*\/\s*(?:mo|month|yr|year)\b)?|psf\b|sf\s*\/\s*(?:mo|month|yr|year)\b)/i;
// A bare decimal directly followed by a MONTHLY period word, no $ needed — small magnitude, so
// it can never collide with a lease TERM ("10 yr"/"10 years" stay term-shaped; a term is never
// stated in fractional months this small).
const RATE_BARE_MONTHLY_RE = /(?<!\$)\b([\d,]*\.\d+)\s*(k|m)?\s*(?:\/?\s*mo\b|\/?\s*month\b|monthly\b)/i;
// With an explicit "$", "yr"/"year"/"annual" are unambiguous too.
const RATE_DOLLAR_PERIOD_RE = /\$\s*([\d,]*\.?\d+)\s*(k|m)?\s*(?:\/?\s*mo\b|\/?\s*month\b|\/?\s*yr\b|\/?\s*year\b|monthly\b|annual\b)/i;
// Bare decimal with lease context ANYWHERE in the text (NNN/gross/lease words) — never a number
// immediately followed by a term-duration word or a "%" sign, both of which belong elsewhere.
const RATE_BARE_CONTEXT_RE = /\$?\s*([\d,]*\.\d+)\b(?!\s*%)(?!\s*[- ]?\s*(?:yrs?|years?|mo|mos|months?)\b)/i;
// Last resort: a bare decimal with NO other signal at all. Read by magnitude only — the
// 0.10–5.00 band is the industry's own default for a monthly $/SF rate (DEFECT C) — never a
// number immediately adjacent to an area unit (that's a SIZE, not a rate) or a "%" (escalation).
// An optional leading "$" is fine here (it's still just corroboration, not a required marker —
// DEFECT C) — only a preceding digit/dot is excluded, which would mean this number is a
// fragment of a larger one already handled elsewhere.
const RATE_MAGNITUDE_FALLBACK_RE = /(?<![\d.])\$?\s*(\d{0,3}\.\d+)\b(?!\s*%)(?!\s*(?:k|m|mm)\b)(?!\s*(?:ac|acres?|sf|square))/i;

function findRateToken(text) {
  const t = String(text || "");
  let m = t.match(RATE_SF_RE);
  if (m) return wrapMoneyMatch(t, m);
  m = t.match(CENTS_RE);
  if (m) return { value: round2(Number(m[1]) / 100), soft: false, working: blank(t, m), negative: precededByDroppedMinus(t, m.index), rawMatch: m[0] };
  m = t.match(RATE_BARE_MONTHLY_RE);
  if (m) return wrapMoneyMatch(t, m);
  m = t.match(RATE_DOLLAR_PERIOD_RE);
  if (m) return wrapMoneyMatch(t, m);
  if (LEASE_WORDS.test(t) || BASIS_RE.test(t)) {
    m = t.match(RATE_BARE_CONTEXT_RE);
    if (m) {
      if (hasAmbiguousGrouping(m[1])) return { value: null, soft: false, invalid: true, working: blank(t, m), rawMatch: m[0] };
      return { value: round2(Number(m[1].replace(/,/g, ""))), soft: false, working: blank(t, m), negative: precededByDroppedMinus(t, m.index), rawMatch: m[0] };
    }
  }
  m = t.match(RATE_MAGNITUDE_FALLBACK_RE);
  if (m) {
    const n = Number(m[1]);
    if (n >= 0.10 && n < 5) {
      return {
        value: round2(n), soft: true, working: blank(t, m),
        negative: precededByDroppedMinus(t, m.index), rawMatch: m[0],
        reason: "Read as a bare number with no $ sign or unit — assumed a monthly $/SF rate by its size. Check it.",
      };
    }
  }
  return null;
}

/** A land/building-sale UNIT price ("$62,700/ac", "$92.40 psf") — never a lease rate, so this
 * is only tried when the surrounding text does NOT read as a lease. Returns
 * `{ perUnit, unit, working }` or null. */
const UNIT_PRICE_AC_RE = /\$\s*([\d,]*\.?\d+)\s*\/\s*ac\b/i;
const UNIT_PRICE_SF_RE = /\$\s*([\d,]*\.?\d+)\s*(?:\/\s*sf\b|psf\b)/i;

/** `text` is the line being scanned; `context` is the whole record (the sale/lease signal that
 * disambiguates a "$X psf" figure from a lease rate often lives on a DIFFERENT line of the same
 * abstract than the dollar figure itself — "Building sold" / "$92.40 psf"). */
function findSaleUnitPrice(text, context) {
  const t = String(text || "");
  const c = String(context ?? t);
  const leaseish = LEASE_WORDS.test(c) || BASIS_RE.test(c) || TI_MENTION_RE.test(c);
  let m = t.match(UNIT_PRICE_AC_RE);
  if (m) return { perUnit: Number(m[1].replace(/,/g, "")), unit: "ac", working: blank(t, m) };
  if (leaseish) return null;
  const saleish = SALE_WORDS.test(c) || LAND_WORDS.test(c) || BUILDING_WORDS.test(c);
  if (!saleish) return null;
  m = t.match(UNIT_PRICE_SF_RE);
  if (m) return { perUnit: Number(m[1].replace(/,/g, "")), unit: "sf", working: blank(t, m) };
  return null;
}

// A bare comma-integer with a "price" label nearby ("1,200,000 price", "price: 1,200,000",
// "sale price of $1,200,000", "sold for 1.2M") is corroborated by the WORD even with no "$" and
// no magnitude suffix — the same "label is corroboration" treatment TI/NOI/cap rate already get
// below, closing the gap where a labelled price fell all the way through to
// `findPriceToken`'s bare-number refusal and was lost to notes (SEVERITY-1 live report).
const PRICE_LABEL_RE = /(?:sale\s*price|purchase\s*price|asking\s*price|list\s*price|sold\s*for|\bprice\b)/i;
const PRICE_VALUE_THEN_LABEL_RE = new RegExp(`\\$?\\s*([\\d,]*\\.?\\d+)\\s*(k|m|mm|thousand|million)?\\s*(?:${PRICE_LABEL_RE.source})`, "i");
const PRICE_LABEL_THEN_VALUE_RE = new RegExp(`(?:${PRICE_LABEL_RE.source})\\s*(?:of|:|is|was)?\\s*\\$?\\s*([\\d,]*\\.?\\d+)\\s*(k|m|mm|thousand|million)?`, "i");

/** A "price"-labelled number, both directions — the one corroboration `findPriceToken`'s own
 * bare-number path deliberately refuses to accept on its own. Returns the same shape
 * `wrapMoneyMatch` does, or null. */
function findLabeledPrice(text) {
  const t = String(text || "");
  const m = t.match(PRICE_VALUE_THEN_LABEL_RE) || t.match(PRICE_LABEL_THEN_VALUE_RE);
  return m ? wrapMoneyMatch(t, m) : null;
}

function findPriceToken(text) {
  // A price needs SOME corroboration beyond a bare number — an explicit "$", a magnitude suffix
  // (k/m/mm/thousand/million), or a "price" label (findLabeledPrice, tried first by the caller).
  // A totally bare comma-integer with none of those is exactly the "genuinely ambiguous" case the
  // disambiguation rule says to leave blank rather than guess (it reads identically to an
  // unlabeled SIZE).
  const t = String(text || "");
  const m = t.match(/\$\s*([\d,]*\.?\d+)\s*(k|m|mm|thousand|million)?\b|\b([\d,]*\.?\d+)\s*(k|m|mm|thousand|million)\b/i);
  if (!m) return null;
  const rawNum = m[1] ?? m[3];
  const rawSuffix = m[2] ?? m[4];
  const mv = moneyVal(rawNum, rawSuffix);
  return { ...mv, working: blank(t, m), negative: precededByDroppedMinus(t, m.index), rawMatch: m[0] };
}

/* ---- dates: execution vs commencement -------------------------------------------------------- */

// RCD (rent commencement date) / LCD (lease commencement date) are COMMENCEMENT, never
// Executed. A bare date with no qualifier at all is EXECUTED (unchanged).
const COMMENCEMENT_LINE_RE = /\b(commenc\w*|RCD|LCD)\b/i;

/* ---- address / title --------------------------------------------------------------------- */

function looksLikeAddressLine(text) {
  return /^\s*\d+\s+\S/.test(text) && STREET_SUFFIX_RE.test(text);
}

/* ---- parties ---------------------------------------------------------------------------------
 * TT:/Tenant:/T:/"tenant is" -> tenant. LL:/Landlord:/LL -/"landlord is" -> landlord.
 * Seller:/Buyer:/Purchaser:/Grantor/Grantee -> the sale pair. "Core5 / Modular Power" (two
 * proper-noun phrases joined by a slash, nothing else on the line) -> landlord/tenant (or
 * seller/buyer) in that order. */

const PROVIDER_IS_RE = /\b(?:landlord|owner|seller|developer|grantor)\s+is\s+([^,;.\n]+)/i;
const ACQUIRER_IS_RE = /\b(?:tenant|buyer|purchaser|grantee)\s+is\s+([^,;.\n]+)/i;
const SLASH_PARTY_LINE_RE = /^\s*([A-Z][\w&.,'-]*(?:\s+[A-Z][\w&.,'-]*)*)\s*\/\s*([A-Z][\w&.,'-]*(?:\s+[A-Z][\w&.,'-]*)*)\s*$/;

function findPartyIsPhrasing(text) {
  const providerM = text.match(PROVIDER_IS_RE);
  const acquirerM = text.match(ACQUIRER_IS_RE);
  return {
    provider: providerM ? providerM[1].trim() : null, providerMatch: providerM,
    acquirer: acquirerM ? acquirerM[1].trim() : null, acquirerMatch: acquirerM,
  };
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
    capRate: null, noi: null, hadRecognizedNote: false,
    commencementDate: null, commencementEstimated: false, commencementSourceLine: null,
  };
}

// A recognized fact with no structured field to live in (turnkey, CPI, a dollar-denominated
// escalation, an unmatched unit price) still anchors a row — `hadRecognizedNote` is what tells
// genericHasAnything a note came from a DETECTOR, not from the generic unrecognized-leftover
// path (which must NOT, on its own, conjure a row out of pure noise — see the "hello/world"
// case in the test suite).
function genericHasAnything(g) {
  return !!(g.compDate || g.title || g.partyProvider || g.partyAcquirer || g.price != null ||
    g.rate != null || g.sizeValue != null || g.term || g.ti != null || g.freeRentMonths != null ||
    g.escalationPct != null || g.capRate != null || g.noi != null || g.commencementDate || g.hadRecognizedNote);
}

function addNote(g, text) {
  if (!text) return;
  g.notes = g.notes ? `${g.notes}; ${text}` : text;
}

function addRecognizedNote(g, text) {
  addNote(g, text);
  g.hadRecognizedNote = true;
}

/** SEVERITY-1 finding (live report, 2026-09-02): a dropped negative sign ("-5.00/SF/yr" ->
 * silently $5) or an ambiguous decimal/thousands grouping ("1.234,56" -> silently 23,456, a
 * ~19,000x error) must never populate a field with a value that LOOKS fine but silently isn't —
 * the textbook BLOCKING case (the risk isn't visible in the shown value). Neither is guessed:
 * the field is left genuinely blank, the exact raw text is preserved in notes so nothing
 * vanishes, and a blocking flag keeps the row out of "ready to save" until a person re-enters
 * the number by hand. */
function flagUnreadableNumber(generic, flags, fieldKey, hit, label) {
  addRecognizedNote(generic, hit.invalid
    ? `${label}: couldn't read "${hit.rawMatch}" safely — ambiguous number format (mixed decimal/thousands separators). Enter it manually.`
    : `${label}: read "${hit.rawMatch}" — a negative amount isn't valid here and the sign was dropped. Enter the correct number manually.`);
  mergeFlag(flags, fieldKey, "blocking", hit.invalid
    ? "Ambiguous number format (decimal vs. thousands separator) — check and re-enter."
    : "A negative sign was found and dropped — check and re-enter.");
}

/** The scavenger core, shared by every unlabeled line in every shape (single-record AND the
 * per-line list). Claims every field it can find, in order from most-specific to least — each
 * claim BLANKS its span out of a working copy so a later, more general detector (rate, price)
 * can never re-read or misinterpret a token a specific one (TI, escalation, cap, NOI, free rent,
 * term, size) already owns. Whatever real content is left over at the end is preserved verbatim
 * via `addNote` rather than silently dropped (DEFECT A) — never dumped wholesale the way a
 * fully-unmatched LINE used to be; here it's whatever fragment nothing could place. */
function extractUnlabeledLine(generic, flags, rawLine, recordContext) {
  const line = String(rawLine || "");
  // The sale/lease context a unit price needs to disambiguate itself often lives on a DIFFERENT
  // line of the same record ("Building sold" / "$92.40 psf") — recordContext is the whole
  // record's text for that one contextual check; defaults to the line itself for the per-line
  // list shape, where each line IS its own record.
  const context = recordContext != null ? recordContext : line;
  let working = line;
  let claimedAnything = false;

  if (!generic.title && looksLikeAddressLine(line)) {
    generic.title = line.trim();
    working = " ".repeat(working.length); // the whole line IS the title — nothing else to read
    claimedAnything = true;
  }

  const isCommencementLine = COMMENCEMENT_LINE_RE.test(line);
  if (isCommencementLine && generic.commencementDate == null) {
    const d = findDateTokenRaw(working);
    if (d) {
      generic.commencementDate = d.iso;
      generic.commencementEstimated = /estimat/i.test(line);
      generic.commencementSourceLine = line.trim();
      // The whole line's point IS the commencement date — "Commencement estimated to be June 1,
      // 2027" has nothing else worth reading once the date is claimed, same as an address line.
      working = " ".repeat(working.length);
      claimedAnything = true;
    }
  }

  if (generic.freeRentMonths == null) {
    const fr = findFreeRentMonths(working);
    if (fr) { generic.freeRentMonths = fr.value; working = fr.working; claimedAnything = true; }
  }

  if (generic.ti == null) {
    const tiHit = findTiToken(working);
    if (tiHit) { generic.ti = tiHit.value; working = tiHit.working; claimedAnything = true; }
    else if (findTurnkeyMention(working)) { addRecognizedNote(generic, "TI: turnkey (landlord-built, no $ allowance stated)"); claimedAnything = true; }
  }

  if (generic.noi == null) {
    const noiHit = findNoiToken(working);
    if (noiHit) {
      generic.noi = noiHit.value;
      if (noiHit.soft) mergeFlag(flags, "noi", "soft", "Had a k/m suffix — check the expanded value.");
      working = noiHit.working;
      claimedAnything = true;
    }
  }

  if (generic.capRate == null) {
    const capHit = findCapRateToken(working);
    if (capHit) { generic.capRate = capHit.value; working = capHit.working; claimedAnything = true; }
  }

  if (generic.escalationPct == null) {
    const dollarEscal = findDollarEscalation(working);
    if (dollarEscal) { addRecognizedNote(generic, dollarEscal.note); working = dollarEscal.working; claimedAnything = true; }
    else {
      const escHit = findEscalationPct(working);
      if (escHit) { generic.escalationPct = escHit.value; working = escHit.working; claimedAnything = true; }
      else if (findCpiMention(working)) { addRecognizedNote(generic, "Escalation: CPI-based (no fixed % stated)"); claimedAnything = true; }
    }
  }

  if (!generic.term) {
    const termHit = findTermBare(working);
    if (termHit) { generic.term = termHit.text; working = termHit.working; claimedAnything = true; }
  }

  if (generic.sizeValue == null) {
    const sizeHit = findSizeToken(working);
    if (sizeHit) {
      if (sizeHit.invalid || sizeHit.negative) {
        flagUnreadableNumber(generic, flags, "sizeValue", sizeHit, "Size");
      } else {
        generic.sizeValue = sizeHit.value;
        generic.sizeUnit = sizeHit.unit;
        if (sizeHit.soft) mergeFlag(flags, "sizeValue", "soft", "Had a k/m suffix — check the expanded value.");
      }
      working = sizeHit.working;
      claimedAnything = true;
    }
  }

  if (generic.rate == null && generic.price == null) {
    const unitPrice = findSaleUnitPrice(working, context);
    if (unitPrice) {
      working = unitPrice.working;
      claimedAnything = true;
      if (generic.sizeValue != null && generic.sizeUnit === unitPrice.unit) {
        generic.price = round2(unitPrice.perUnit * generic.sizeValue);
        mergeFlag(flags, "price", "soft", `Derived from $${unitPrice.perUnit}/${unitPrice.unit.toUpperCase()} x the stated size — check the math.`);
      } else {
        addRecognizedNote(generic, `Unit price: $${unitPrice.perUnit}/${unitPrice.unit.toUpperCase()} (no matching size given to compute a total)`);
      }
    }
  }

  if (generic.rate == null) {
    const rateHit = findRateToken(working);
    if (rateHit) {
      if (rateHit.invalid || rateHit.negative) {
        // Deliberately does NOT also claim period/basis words here — with no rate value to pair
        // them with, they're more useful left visible in notes so a person re-entering the rate
        // by hand has the full original context ("NNN annual") in front of them.
        flagUnreadableNumber(generic, flags, "rate", rateHit, "Rate");
        working = rateHit.working;
        claimedAnything = true;
      } else {
        generic.rate = rateHit.value;
        if (rateHit.soft) mergeFlag(flags, "rate", "soft", rateHit.reason || "Had a k/m suffix — check the expanded value.");
        generic.ratePeriod = generic.ratePeriod || detectPeriod(line);
        const basisWord = generic.rateBasis ? null : working.match(BASIS_NNN_RE) || working.match(BASIS_GROSS_RE);
        // B986096 (owner report, 2026-09-02) — detectPeriod reads the ORIGINAL `line` to set
        // ratePeriod, but that alone never removes the matched word from `working`. When the period
        // is part of a COMPOUND rate match (".56/SF/mo") it's already blanked via `rateHit.working`
        // below; a STANDALONE period word elsewhere on the line (".56/SF NNN annual") never was,
        // and leaked verbatim into Notes even though it was genuinely recognized and consumed. Same
        // "claim it, blank it" contract as basisWord right above — a consumed token must not also
        // survive in Notes.
        const periodWord = working.match(PERIOD_RE);
        generic.rateBasis = generic.rateBasis || detectBasis(line);
        working = rateHit.working;
        if (basisWord) working = blank(working, basisWord);
        if (periodWord) working = blank(working, periodWord);
        claimedAnything = true;
      }
    }
  }

  if (!isCommencementLine && generic.compDate == null) {
    const dateTok = findDateTokenRaw(working);
    if (dateTok) {
      generic.compDate = dateTok.iso;
      if (dateTok.soft) mergeFlag(flags, "compDate", "soft", dateTok.reason || "Day of month wasn't given — defaulted to the 1st.");
      working = blank(working, dateTok.match);
      claimedAnything = true;
    }
  }

  if (generic.price == null && generic.rate == null) {
    const priceHit = findLabeledPrice(working) || findPriceToken(working);
    if (priceHit) {
      if (priceHit.invalid || priceHit.negative) {
        flagUnreadableNumber(generic, flags, "price", priceHit, "Price");
      } else {
        generic.price = priceHit.value;
        if (priceHit.soft) mergeFlag(flags, "price", "soft", "Had a k/m suffix — check the expanded value.");
      }
      working = priceHit.working;
      claimedAnything = true;
    }
  }

  if (!generic.partyProvider || !generic.partyAcquirer) {
    const { provider, acquirer, providerMatch, acquirerMatch } = findPartyIsPhrasing(working);
    if (provider && !generic.partyProvider) { generic.partyProvider = provider; working = blank(working, providerMatch); claimedAnything = true; }
    if (acquirer && !generic.partyAcquirer) { generic.partyAcquirer = acquirer; working = blank(working, acquirerMatch); claimedAnything = true; }
    if (!generic.partyProvider && !generic.partyAcquirer) {
      const slash = line.match(SLASH_PARTY_LINE_RE);
      if (slash) {
        generic.partyProvider = slash[1].trim();
        generic.partyAcquirer = slash[2].trim();
        working = " ".repeat(working.length); // the whole line IS the two party names
        claimedAnything = true;
      }
    }
  }

  if (!claimedAnything) {
    const leftover = line.trim();
    if (leftover) addNote(generic, leftover);
    return;
  }
  // Partial claim: whatever's left in `working` after every detector had its turn is real
  // unrecognized content (not just the punctuation/glue the claims left behind) — keep it too.
  // B986096 (owner report, 2026-09-02) — stripping "," left the space that FOLLOWED it behind
  // ("Houston, TX 77073" -> "Houston  TX 77073", a double space) — collapse any run of whitespace
  // the comma-strip produces down to one, same as every other leftover-text normalization here.
  const leftover = working.replace(/[,;|]+/g, " ").replace(/\s+/g, " ").trim();
  if (leftover) addNote(generic, leftover);
}

function remapFlagKey(key, compType) {
  if (key === "price") return compType === "building_sale" ? "bldgPrice" : "landPrice";
  if (key === "sizeValue") return compType === "land" ? "landSizeValue" : compType === "building_sale" ? "bldgSizeSf" : "leaseSizeSf";
  if (key === "rate") return "leaseRate";
  if (key === "noi") return "bldgNoi";
  return key;
}

/** The ONE place a lease row's period/basis ambiguity — and an estimated-commencement date —
 * are judged, shared by every shape, so "does this block" can never disagree between a pasted
 * line, a single-record abstract, or a spreadsheet cell. Remaps the generic-level flag keys
 * (price/sizeValue/rate/noi) onto the type-specific field the grid actually renders. */
function finalizeGenericRow(generic, rawFlags, raw) {
  const flags = {};
  for (const [k, v] of Object.entries(rawFlags)) flags[remapFlagKey(k, generic.compType)] = v;

  if (generic.compType === "lease") {
    if (generic.rate != null) {
      if (!generic.ratePeriod) {
        mergeFlag(flags, "leaseRatePeriod", "blocking",
          `No monthly/annual period was given — $${generic.rate} means something 12x different either way. Pick one before saving.`);
      }
      // SEVERITY-1 finding (live report, 2026-09-02): a $0 rate and an implausibly huge one both
      // saved silently, with no ceiling at all ("999999999/SF/yr" went straight through). Both
      // are SOFT, not blocking — the shown number IS what was typed, correctable at a glance, not
      // a hidden-risk case like the dropped-sign/ambiguous-grouping ones below — but neither may
      // pass through unremarked: a genuine $0 deal (an incentive/abated comp) and a fat-fingered
      // decimal point look identical to a machine, so both get a visible amber note.
      if (generic.rate === 0) {
        mergeFlag(flags, "leaseRate", "soft", "Rate reads $0 — confirm this is correct (e.g. an incentive/abated deal), not a missing value.");
      } else if (generic.rate > RATE_IMPLAUSIBLE_CEILING) {
        mergeFlag(flags, "leaseRate", "soft",
          `$${generic.rate}/SF/${generic.ratePeriod === "monthly" ? "mo" : "yr"} is far above a realistic rate — check for a missing decimal point or a unit mismatch.`);
      }
    }
    // ⛔ B986096 ×9 (owner amendment, 2026-09-02) — BASIS defaults to NNN when the text doesn't
    // say, because industrial leases are overwhelmingly triple-net and a gross deal is the
    // exception a broker names explicitly. This is DELIBERATELY NOT the same treatment as
    // PERIOD above: basis has one answer that is nearly always right (a helpful default), period
    // has two common answers 12x apart (a guess there corrupts every comparison in the sheet) —
    // collapsing the two into one rule would be exactly the mistake this distinction exists to
    // prevent. No flag, no note, no marker: a defaulted NNN renders identically to a stated one
    // (the owner has already rejected an unexplained asterisk/badge once, and a live soft flag
    // here would render exactly the tooltip/ProblemsList sentence he ruled out). Applies whenever
    // the row is typed as a lease — independent of whether a rate was successfully read — so
    // `genericToDraft`'s unconditional `d.leaseRateExpense = generic.rateBasis` never regresses
    // to a raw `null` (rather than the blank-string convention every other unset field uses).
    if (!generic.rateBasis) generic.rateBasis = "nnn";
  }
  // ⛔ B986096-HARDENING-8 (owner correction, reversing HARDENING-6's stand-in) — EXECUTION and
  // COMMENCEMENT are different facts about different moments, and a comp's Date column is USED:
  // comp_date drives every recency filter and sort, so quietly writing a commencement date into
  // it fabricates an execution date that never happened. A commencement date lands ONLY in its
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
 * blank default, per the entry grid's own rule that an empty cell is just a cell.
 * ⛔ B986096 ×9 — `compType` defaults to `""` (BLANK), never `"land"` any more: a row whose type
 * could not be determined must say so rather than guess, and guessing wrong is exactly what
 * used to throw away every economic field a correctly-typed row would have kept (see the file
 * header, DEFECT A). A commencement date lands in `leaseCommencementDate` when one was found;
 * it NEVER also fills `compDate` — see `finalizeGenericRow`'s header for why that stand-in was
 * removed. */
function genericToDraft(generic) {
  const d = {
    compType: "", compDate: "", leaseCommencementDate: "", title: "", notes: "", teamId: null, projectId: null, anchor: null,
    partyProvider: "", partyAcquirer: "",
    landPrice: "", landSizeValue: "", landSizeUnit: "ac",
    bldgPrice: "", bldgSizeSf: "", bldgNoi: "", bldgCapRate: "",
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
    if (generic.noi != null) d.bldgNoi = String(generic.noi);
    // Stored as a DECIMAL FRACTION (0.0625), typed/read here as a raw percentage (6.25) — the
    // exact convention `compSheetColumns.js`'s bldgCapRate column get/set pair already uses, so
    // the two conversions can never disagree.
    if (generic.capRate != null) d.bldgCapRate = String(generic.capRate / 100);
  } else if (d.compType === "lease") {
    if (generic.rate != null) d.leaseRate = String(generic.rate);
    if (generic.ratePeriod) d.leaseRatePeriod = generic.ratePeriod;
    // HARDENING-11 — `generic.rateBasis` already defaults to "nnn" by the time this runs
    // (`finalizeGenericRow`'s own basis-default, which fires before it calls `genericToDraft`),
    // unless the pasted text stated a gross-family term (`detectBasis`/`BASIS_RE` wins outright).
    // Per (leaseRatePeriod, above) gets NO such default — see this file's header.
    d.leaseRateExpense = generic.rateBasis;
    if (generic.sizeValue != null) d.leaseSizeSf = String(generic.sizeValue);
    if (generic.ti != null) d.leaseTi = String(generic.ti);
    if (generic.term) d.leaseTerm = generic.term;
    if (generic.freeRentMonths != null) d.leaseFreeRentMonths = String(generic.freeRentMonths);
    if (generic.escalationPct != null) d.leaseEscalationPct = String(generic.escalationPct);
  }
  return d;
}

/** One line -> `{ generic, flags }`, never finalized to a draft. Shared by `parseProseLine` (the
 * per-line-list shape, where every line is judged fully in isolation) and `detectFieldCollisions`
 * below (B1063904 — the merge-safety check needs each line's OWN read of every field, independent
 * of what any other line claims, which is exactly what this builds). `respectLabels` makes a
 * label-prefixed line ("TT: Acme" / "Rate: $0.65/SF") resolve through `applyLabeledLine` instead
 * of the generic scavenger — this is what `parseSingleRecord`'s own per-line loop does, so the
 * collision check reads each line the SAME way the merge it's guarding actually reads it (a
 * `parseProseLine` caller never wants this — a bare per-line list has no labels to respect, and
 * changing that behavior would be a second regression, not a fix). */
function buildLineGeneric(line, { respectLabels } = {}) {
  const generic = emptyGeneric();
  const flags = {};
  const sawLeaseLabel = { value: false };
  const labelMatch = respectLabels ? line.match(LABEL_PREFIX_RE) : null;
  if (labelMatch) {
    applyLabeledLine(generic, flags, sawLeaseLabel, labelMatch[1], line.slice(labelMatch[0].length));
  } else {
    extractUnlabeledLine(generic, flags, line);
  }

  if (!generic.compType) {
    if (sawLeaseLabel.value) {
      generic.compType = "lease";
    } else {
      const guess = detectCompType(line);
      if (guess.value) {
        generic.compType = guess.value;
        if (guess.soft) flags.compType = { level: "soft", reason: "Type guessed from the wording — check it." };
      } else {
        const inferred = inferTypeFromCapturedFields(generic);
        if (inferred) { generic.compType = inferred; flags.compType = { level: "soft", reason: "Type guessed from which figures were given — check it." }; }
      }
    }
  }
  return { generic, flags };
}

/** One prose line (broker-email style) -> `{ draft, cellFlags, raw }`, or `null` if the line
 * contributed nothing (never emit an entirely empty row). Used for the MANY-RECORDS-ONE-PER-LINE
 * shape, where each line is expected to be a complete, independent comp — runs the SAME
 * scavenger `extractUnlabeledLine` the single-record shape uses (B986096 ×9 — previously a
 * separate, simpler extractor that only tried one match per field and only one label direction). */
export function parseProseLine(line) {
  const { generic, flags } = buildLineGeneric(line);
  if (!genericHasAnything(generic)) return null;
  return finalizeGenericRow(generic, flags, line);
}

/* ---- MERGE SAFETY — B1063904 (owner report, 2026-09-02): "5 AC land sale" + ".56/SF , 12 TI, 3%
 * bumps" merged into ONE row that kept line 1's Size (5) and let line 2 overwrite the Unit to SF —
 * 5 ACRES silently became 5 SQUARE FEET, wrong by a factor of 43,560, and invisible because "5"
 * still looks plausible. Root cause: `parseSingleRecord` resolves `compType` ONCE, from the whole
 * JOINED text, so a lease word anywhere in a multi-line paste can flip the type away from what an
 * earlier line's own size unit assumed, and `genericToDraft` only ever writes a size into the
 * field the FINAL resolved type owns (`leaseSizeSf` has no unit — it's always SF) — an acre-unit
 * size captured under a different type has nowhere safe to land.
 *
 * The fix is not a smarter merge — it's knowing WHEN NOT TO MERGE. Merging multiple lines into one
 * comp is only safe when the lines are COMPLEMENTARY (disjoint fields — a broker email where the
 * address is on one line and the rate is on the next, which is the shape the merge exists for).
 * The moment two lines independently parse to DIFFERENT values for the same field, merging is a
 * guess, and for Type/Unit specifically a wrong guess changes the MEANING of every other number on
 * the row — so those two are never mergeable, full stop, and every other field currently follows
 * the same rule (a future relaxation of the general case must not touch Type/Unit). */

// Fields compared for a collision, paired with the label shown on the panel when they disagree.
// Free-text fields (notes/title/parties/dates) are deliberately excluded: two lines legitimately
// naming two different facts there is the COMPLEMENTARY case this rule exists to keep merging.
// Type and Unit lead the list because they are NEVER mergeable (see header) — every other field
// currently gets the same treatment, but if that's ever relaxed, these two must stay absolute.
const COLLISION_FIELDS = [
  ["compType", "Type"], ["sizeUnit", "Unit"],
  ["sizeValue", "Size"], ["rate", "Rate"], ["price", "Price"], ["ratePeriod", "Rate period"],
  ["rateBasis", "Basis"], ["ti", "TI"], ["noi", "NOI"], ["capRate", "Cap rate"], ["escalationPct", "Escalation"],
];

/** Parses every line fully independently (each reads only itself, `respectLabels: true` so a
 * label-prefixed line is read the same way the merge it's guarding reads it — see
 * `buildLineGeneric`) and returns the display names of every field two or more lines disagree on,
 * or `[]` when the lines are complementary. A field only one line claims — or that every line
 * claiming it agrees on — is not a collision; that's the normal, safe merge case. */
function detectFieldCollisions(lines) {
  if (lines.length < 2) return [];
  const generics = lines.map((line) => buildLineGeneric(line, { respectLabels: true }).generic);
  const collided = [];
  for (const [key, label] of COLLISION_FIELDS) {
    const values = generics.map((g) => g[key]).filter((v) => v != null && v !== "");
    const distinct = new Set(values.map((v) => String(v).toLowerCase()));
    if (distinct.size > 1) collided.push(label);
  }
  return collided;
}

/* ---- SINGLE RECORD OVER MANY LINES — the dominant shape: a lease/sale abstract ------------ */

// Label:value line prefixes, industrial-brokerage shorthand included (TT=Tenant, LL=Landlord,
// TI=Tenant Improvement allowance) — a small domain lexicon, not generic pattern matching. The
// separator between label and value is a colon OR a dash ("LL -"), not just a colon.
const LABEL_PREFIX_RE = /^\s*(TT|LL|TI|T|Landlord|Tenant|Owner|Developer|Seller|Buyer|Purchaser|Grantor|Grantee|Rate|Term|Type|Date|Notes)\s*(?::|-)\s*/i;
const LABEL_FIELD = {
  tt: "partyAcquirer", tenant: "partyAcquirer", buyer: "partyAcquirer", purchaser: "partyAcquirer", grantee: "partyAcquirer", t: "partyAcquirer",
  ll: "partyProvider", landlord: "partyProvider", owner: "partyProvider", developer: "partyProvider", seller: "partyProvider", grantor: "partyProvider",
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
    case "ti": {
      const tiHit = findTiToken(v) || (() => { const n = extractLeadingNumber(v.replace(/^\$/, "").replace(/\/\s*sf/i, "")); return n ? { value: n.value } : null; })();
      if (tiHit) generic.ti = tiHit.value;
      break;
    }
    case "term": { const termHit = findTermBare(v); generic.term = termHit ? termHit.text : (/^\d+(?:\.\d+)?$/.test(v) ? `${v} mo` : v); break; }
    case "rate": {
      const rt = findRateToken(v) || (() => { const n = extractLeadingNumber(v.replace(/^\$/, "").replace(/\/\s*sf/i, "")); return n ? { value: n.value } : null; })();
      if (rt) { generic.rate = rt.value; generic.ratePeriod = generic.ratePeriod || detectPeriod(v); generic.rateBasis = generic.rateBasis || detectBasis(v); }
      break;
    }
    case "compTypeLabel": { const t = normalizeCompTypeToken(v); if (t) generic.compType = t; break; }
    case "compDate": { const d = findDateToken(v); if (d) { generic.compDate = d.iso; if (d.soft) mergeFlag(flags, "compDate", "soft", d.reason || "Day wasn't given — defaulted to the 1st."); } break; }
    case "notes": generic.notes = generic.notes ? `${generic.notes}; ${v}` : v; break;
    default: break; // an unrecognized label still gets its VALUE run through content detectors below
  }
}

/** A whole block of text -> ONE record (the single-multi-line-record shape). Returns `null` if
 * the block contributed nothing at all. Every line is either a recognized label:value pair or
 * run through the same scavenger `extractUnlabeledLine` the per-line list parser uses, merged
 * onto ONE generic record (first match wins per field; a labeled line always takes priority
 * since it's the higher-confidence signal). */
export function parseSingleRecord(text) {
  const lines = splitPasteLines(text);
  const generic = emptyGeneric();
  const flags = {};
  const sawLeaseLabel = { value: false };

  const recordContext = lines.join(" ");
  for (const line of lines) {
    const m = line.match(LABEL_PREFIX_RE);
    if (m) {
      applyLabeledLine(generic, flags, sawLeaseLabel, m[1], line.slice(m[0].length));
    } else {
      extractUnlabeledLine(generic, flags, line, recordContext);
    }
  }

  if (!generic.compType) {
    if (sawLeaseLabel.value) {
      generic.compType = "lease";
    } else {
      const guess = detectCompType(lines.join(" "));
      if (guess.value) {
        generic.compType = guess.value;
        if (guess.soft) flags.compType = { level: "soft", reason: "Type guessed from the wording — check it." };
      } else {
        const inferred = inferTypeFromCapturedFields(generic);
        if (inferred) { generic.compType = inferred; flags.compType = { level: "soft", reason: "Type guessed from which figures were given — check it." }; }
        // else: leave compType null -> the draft's compType stays "" (blank). Never "land".
      }
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
  noi: ["noi"],
  capRate: ["cap", "cap rate"],
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
      if (d) { generic.compDate = d.iso; if (d.soft) mergeFlag(flags, "compDate", "soft", d.reason || "Day wasn't given — defaulted to the 1st."); }
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
    case "rateBasis": generic.rateBasis = /nnn|net/i.test(val) ? "nnn" : /gross|fs|full|\big\b|\bmg\b|base\s*year/i.test(val) ? "gross" : null; break;
    case "ti": { const n = parseMagnitudeNumber(val.replace(/^\$/, "")); if (n) generic.ti = n.value; break; }
    case "term": { const termHit = findTermBare(val); generic.term = termHit ? termHit.text : val; break; }
    case "noi": { const n = parseMagnitudeNumber(val.replace(/^\$/, "")); if (n) generic.noi = n.value; break; }
    case "capRate": { const n = Number(String(val).replace(/%$/, "")); if (Number.isFinite(n)) generic.capRate = n; break; }
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
    if (guess.value) {
      generic.compType = guess.value;
      flags.compType = { level: "soft", reason: "Type wasn't a column — guessed from the row text." };
    } else {
      const inferred = inferTypeFromCapturedFields(generic);
      if (inferred) { generic.compType = inferred; flags.compType = { level: "soft", reason: "Type wasn't a column — guessed from which figures were given." }; }
    }
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
 * `{ mode, rows, splitReason? }` — `mode` is `"empty" | "spreadsheet" | "single" | "split" |
 * "multi"`, `rows` always `[{ draft, cellFlags, raw }]` with no entirely-empty rows. B1063904 —
 * before merging a shape the detector called "single", MERGE SAFETY gets a veto: every line is
 * parsed on its own (`detectFieldCollisions`) and, if any two disagree on the same field, the
 * merge is refused in favor of `"split"` (one row per line, same as `"multi"`) — `splitReason` is
 * the human sentence naming which field(s) disagreed, e.g. "2 lines disagreed on Type — split
 * into 2 comps.", so the panel can say why the user got two rows instead of one. */
export function parsePaste(text) {
  if (!String(text || "").trim()) return { mode: "empty", rows: [] };
  const shape = detectPasteShape(text);
  if (shape === "spreadsheet") return { mode: "spreadsheet", rows: parsePasteBlock(text) };
  if (shape === "single") {
    const lines = splitPasteLines(text);
    const collisions = detectFieldCollisions(lines);
    if (collisions.length) {
      const rows = lines.map(parseProseLine).filter(Boolean);
      const splitReason = `${lines.length} lines disagreed on ${collisions.join(", ")} — split into ${rows.length} comp${rows.length === 1 ? "" : "s"}.`;
      return { mode: "split", rows, splitReason };
    }
    const row = parseSingleRecord(text);
    return { mode: "single", rows: row ? [row] : [] };
  }
  return { mode: "multi", rows: splitPasteLines(text).map(parseProseLine).filter(Boolean) };
}

/** True if any cell in the row is a save-blocker. */
export function rowHasBlockingFlags(cellFlags) {
  return Object.values(cellFlags || {}).some((f) => f?.level === "blocking");
}
