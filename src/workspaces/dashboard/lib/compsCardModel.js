/* compsCardModel — pure model behind the Dashboard's Comps card (NEW-COMPS-CARD). The card itself
 * (components/CompsCard.jsx) is a dumb renderer over what this module computes, same "pure model +
 * dumb renderer" split every other visualization in this repo follows (site-planner/lib/yieldBar.js
 * is the precedent cited when this was built) — so the peer-set rule, the scale geometry and the
 * comparison sentence are all unit-testable without a browser or a network call.
 *
 * WHY A CARD REPLACES A COUNT: a raw "N comps recorded" reads the same every morning and tells the
 * owner nothing actionable — the count only changes when HE adds one. Showing the most recently
 * added comp, placed against its real peers, is a fact that's actually new each time he looks.
 *
 * THE PEER-SET RULE, stated once here because every other function in this file exists to serve
 * it: peers are comps of the SAME comp type, in the SAME county, in a COMPARABLE SIZE BAND, and
 * ON THE SAME MEASURING SCALE as the featured comp — never a blend across counties, deal types,
 * wildly different building sizes, or incompatible scales, and never an average of every comp the
 * owner has ever entered. A comp missing a county or a resolvable size can never join the peer set
 * (there's nothing honest to compare it on) — it's EXCLUDED and counted, never silently dropped or
 * averaged in.
 *
 * ⛔ "ON THE SAME MEASURING SCALE" IS THE HALF THIS FILE SHIPPED WITHOUT, and it produced two
 * absurd cards on real data (adversarial review, 2026-09-08 — reproduce with
 * `ui-audit/review-2026-09-08/probe-comps-peer-set.mjs`):
 *   · A LEASE's rate means nothing without its expense basis. An $11 gross rate and a $5 NNN rate
 *     are the same deal; plotted on one rule they read as a 2× spread. `shared/comps/lib/comps.js`'s
 *     `summarizeLeaseComps` already refuses to blend NNN with gross ("there is no honest conversion
 *     between them without the underlying expense figures the app doesn't have") — the peer set now
 *     enforces the identical rule instead of quietly disagreeing with it.
 *   · A LAND comp's headline rate is quoted in its OWN recorded unit — $/AC or $/SF — and those are
 *     43,560× apart. Two identically-priced 20-acre tracts, one entered in acres and one in SF,
 *     shared a scale and produced the sentence "$129996.90 above the median".
 * A comp that would otherwise have been a peer (same type, county and band) but sits on a different
 * scale is EXCLUDED and counted — never rescaled into agreement, because the conversion that would
 * make it agree is exactly the one the app cannot honestly perform.
 *
 * ⛔ AND THE PERIOD THE CARD SPEAKS IN IS NAMED, NOT IMPLIED, AND — since the period toggle (see
 * `components/CompsCard.jsx`) — IT IS MICHAEL'S CHOICE, NOT A HARDCODED CONSTANT. Lease rates are
 * entered monthly OR annually, per comp; Michael's own account holds both. Every figure this card
 * renders — the featured headline, every peer dot, both scale ticks and the comparison sentence —
 * passes through ONE normalization to ONE period (`period`, threaded through every function
 * below, defaulting to `DEFAULT_LEASE_PERIOD`), so no two numbers on this card can ever be in
 * different periods — they just may now both be monthly instead of both annual. It used to be
 * true only because `annualLeaseRate` happened to be the only rate function in reach; nothing
 * said so, and nothing would have caught it changing.
 */
import {
  landPricePerSf, buildingPricePerSf, leaseRateForPeriod, landPricePerAreaUnit, landSizeSf,
} from "../../../shared/comps/lib/comps.js";
import { daysAgoWords } from "../../../shared/units/dateFormat.js";

export const TYPE_LABEL = { land: "Land", building_sale: "Building sale", lease: "Lease" };

/** The period every function below normalizes to when the caller doesn't say otherwise — matches
 * the comps sheet's own derived `$/SF/yr` column (`shared/comps/lib/compSheetColumns.js`'s
 * `leaseAnnualRate`) and is what a brand-new account (never touched the toggle) sees. */
export const DEFAULT_LEASE_PERIOD = "annual";

/** The `$/SF/yr` or `$/SF/mo` unit string for a chosen lease display period. */
export function leaseRateUnit(period) {
  return period === "monthly" ? "$/SF/mo" : "$/SF/yr";
}

/** THE one rate-figure formatter — 2 decimals under $10 (so a $/mo rate reads as real cents, not
 * a rounded-away dollar), 0 decimals at or above it (matching how every other dollar figure on
 * this dashboard reads). Moved here from `CompsCard.jsx` (B1405457, 2026-09-08 review FEED-3)
 * so `sinceLastHereFeed.js`'s "New comp" row can render the SAME comp's rate through the exact
 * same math AND the exact same formatting the card uses — a second, hand-rolled formatter is
 * exactly how the two surfaces drifted apart the first time. */
export function formatRateValue(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  const decimals = Math.abs(v) < 10 ? 2 : 0;
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}


/** How many peers the horizontal scale needs before it means anything. Below this the card draws no
 * scale and says so in one line — exported so `CompsCard.jsx` and `peerComparisonSentence` can
 * never disagree about where that boundary sits (they used to hold the literal `3` separately, and
 * the card printed "Against your last 1 …" directly above "this one stands alone"). */
export const MIN_PEERS_FOR_SCALE = 3;

/** Half a cent — the point below which two money figures are the SAME figure, not a ranked pair.
 * Shared by the rank phrasing and the median-delta phrasing so the sentence cannot say "the highest"
 * in one clause and "right at the median" in the next. Rates are divisions (price ÷ size), so an
 * exact `===` between two genuinely equal rates is not guaranteed. */
const RATE_EPSILON = 0.005;

// Typical industrial size tiers — a peer set is bucketed into one of these, never a continuous
// tolerance band, so "comparable" means something a reader can state in plain words (matching the
// worked example: "buildings over five hundred thousand square feet").
export const SIZE_BANDS = [
  { key: "under100k", max: 100000, rangeText: "under 100,000 SF" },
  { key: "100to250k", max: 250000, rangeText: "100,000–250,000 SF" },
  { key: "250to500k", max: 500000, rangeText: "250,000–500,000 SF" },
  { key: "over500k", max: Infinity, rangeText: "over 500,000 SF" },
];

/** Which band a size (SF) falls into, or null for a missing/non-positive size — null is the
 * signal that disqualifies a comp from the peer set, never a guessed band. */
export function sizeBandFor(sf) {
  if (sf == null || !Number.isFinite(sf) || sf <= 0) return null;
  return SIZE_BANDS.find((b) => sf < b.max) || SIZE_BANDS[SIZE_BANDS.length - 1];
}

/** The noun a size band reads naturally with, per comp type — "sites" for land (nothing is built
 * yet), "buildings" for a sale or a lease. */
function bandNoun(compType) {
  return compType === "land" ? "sites" : "buildings";
}

/** A size band's sentence-ready phrase for THIS comp type, e.g. "buildings over 500,000 SF" or
 * "sites under 100,000 SF". */
export function bandSentenceLabel(band, compType) {
  if (!band) return null;
  return `${bandNoun(compType)} ${band.rangeText}`;
}

/** The comp's own SIZE, in square feet, following its OWN type's size field — a land comp reads
 * its land size (converted from acres when quoted that way), a building sale its building SF, a
 * lease its leased SF. Null when the size isn't recorded. */
export function compSizeSf(comp) {
  if (!comp) return null;
  if (comp.compType === "land") return landSizeSf(comp.landSizeValue, comp.landSizeUnit);
  if (comp.compType === "building_sale") return comp.bldgSizeSf ?? null;
  if (comp.compType === "lease") return comp.leaseSizeSf ?? null;
  return null;
}

/** The comp's headline RATE — the single biggest number the card renders. Type-honest: a lease's
 * rate normalized to the CHOSEN display `period` (`DEFAULT_LEASE_PERIOD` if omitted) and carrying
 * its NNN/gross basis, a building sale's $/SF price, a land comp's price per its OWN recorded unit
 * (AC or SF) — never a cross-type average and never a borrowed unit. Null when the comp doesn't
 * carry enough to compute one (never guessed), which includes a lease whose period isn't recorded:
 * an un-normalizable rate is not a rate this card can speak, so it is refused rather than printed
 * raw under a mismatched label. `scale` is the key on which two of these may honestly be compared
 * — see `compScaleKey`. */
export function compHeadlineRate(comp, period = DEFAULT_LEASE_PERIOD) {
  if (!comp) return null;
  if (comp.compType === "lease") {
    const v = leaseRateForPeriod(comp, period); // the app's one lease-period converter
    if (v == null) return null;
    const basis = comp.leaseRateExpense || null;
    return { value: v, unit: leaseRateUnit(period), period, basis, scale: compScaleKey(comp, period) };
  }
  if (comp.compType === "building_sale") {
    const v = buildingPricePerSf(comp);
    return v == null ? null : { value: v, unit: "$/SF", period: null, basis: null, scale: compScaleKey(comp) };
  }
  if (comp.compType === "land") {
    const r = landPricePerAreaUnit(comp);
    if (r == null) return null;
    return { value: r.value, unit: `$/${r.unit.toUpperCase()}`, period: null, basis: null, scale: compScaleKey(comp) };
  }
  return null;
}

/** THE SCALE KEY — the identity of the ruler a comp's headline rate is measured against. Two comps
 * may share a peer scale only when these match exactly; anything else is a different ruler wearing
 * the same "$" sign. Null means the comp declares no usable scale at all (an unstated lease basis —
 * `summarizeLeaseComps` counts exactly this case as `unknownCount` — or a land size in no known
 * unit), which disqualifies it rather than defaulting it. Building sales are always plain $/SF, so
 * they carry one shared key. `period` only distinguishes a lease's ruler — every rate on one card
 * render shares the same chosen period, so this never causes a false non-match in practice. */
export function compScaleKey(comp, period = DEFAULT_LEASE_PERIOD) {
  if (!comp) return null;
  if (comp.compType === "lease") {
    const basis = comp.leaseRateExpense;
    if (basis !== "nnn" && basis !== "gross") return null;
    return `lease:${period}:${basis}`;
  }
  if (comp.compType === "building_sale") return "building_sale:sf";
  if (comp.compType === "land") {
    const unit = comp.landSizeUnit;
    if (unit !== "ac" && unit !== "sf") return null;
    return `land:${unit}`;
  }
  return null;
}

/** How the card names a scale in one short phrase, for the "excluded" note — so the reason a comp
 * was held out is stated, never left as a bare count. Matched by SUFFIX rather than the old exact
 * `"lease:annual:nnn"` string — a scale key now carries whichever period the card is displaying
 * (`compScaleKey`), and this must recognize a lease's basis regardless of which period that is. */
export function scaleLabel(scaleKey) {
  if (!scaleKey) return null;
  if (scaleKey.startsWith("lease:") && scaleKey.endsWith(":nnn")) return "NNN";
  if (scaleKey.startsWith("lease:") && scaleKey.endsWith(":gross")) return "gross";
  if (scaleKey === "land:ac") return "$/AC";
  if (scaleKey === "land:sf") return "$/SF";
  return null;
}

/** Same-county, same-type, same-size-band, SAME-SCALE peers for `featured` — the ONE place the
 * peer-set rule (this file's own header) is enforced. Returns
 * `{ peers, excludedCount, excludedReason, band, county, scale }`. `peers` is `[{ comp, rate }]`,
 * every rate already on `scale`'s ruler, ready to plot without further conversion.
 *
 * `excludedCount` counts comps that WOULD have been peers but couldn't honestly be placed, for two
 * distinct reasons, both reported: `incomplete` — a same-type comp missing a county, a resolvable
 * size, or a computable rate; and `incomparable` — a comp matching on type, county and band but
 * measured on a different scale (gross against NNN, $/AC against $/SF). A comp that is simply a
 * different type, county or band is NOT an exclusion, just a non-match, and is never counted.
 * Never mutates its input. `period` is the display period every rate normalizes to (see this
 * file's header) — defaults to `DEFAULT_LEASE_PERIOD` so an untouched card behaves exactly as it
 * did before the period toggle existed. */
export function buildPeerSet(allComps, featured, period = DEFAULT_LEASE_PERIOD) {
  const county = featured?.anchor?.county || null;
  const band = featured ? sizeBandFor(compSizeSf(featured)) : null;
  const scale = compScaleKey(featured, period);
  const empty = { peers: [], excludedCount: 0, excludedReason: null, band, county, scale };
  if (!featured || !county || !band || !scale) return empty;
  let incomplete = 0;
  let incomparable = 0;
  const peers = [];
  for (const c of allComps || []) {
    if (!c || c.id === featured.id) continue;
    if (c.compType !== featured.compType) continue;
    const cCounty = c.anchor?.county || null;
    const cBand = sizeBandFor(compSizeSf(c));
    const cRate = compHeadlineRate(c, period);
    if (!cCounty || !cBand || cRate == null) { incomplete++; continue; }
    if (cCounty !== county || cBand.key !== band.key) continue; // a non-match, not an exclusion
    // Matched on type, county and band — so this comp WOULD be a peer. It joins only if it is
    // measured on the same ruler; otherwise it is held out and said so, never rescaled.
    if (cRate.scale !== scale) { incomparable++; continue; }
    peers.push({ comp: c, rate: cRate.value });
  }
  return {
    peers,
    excludedCount: incomplete + incomparable,
    excludedReason: excludedReasonText(incomplete, incomparable, scale),
    band,
    county,
    scale,
  };
}

/** The short "why" clause behind an exclusion count — one phrase, naming the real reason rather
 * than the old fixed "missing county or size" (which was wrong the moment a second reason existed). */
function excludedReasonText(incomplete, incomparable, scale) {
  if (!incomplete && !incomparable) return null;
  const label = scaleLabel(scale);
  const mismatch = label ? `not quoted ${label}` : "on a different scale";
  if (incomplete && incomparable) return `${mismatch}, or missing county or size`;
  if (incomparable) return mismatch;
  return "missing county or size";
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const ORDINAL_WORDS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
  "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"];
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

function ordinalWord(n) { return ORDINAL_WORDS[n] || `${n}th`; }
function countWord(n) { return COUNT_WORDS[n] || String(n); }

/** Where the featured rate sits among all of them, TIES INCLUDED. A rank is a claim that one
 * number beat the others; when several comps carry the same rate that claim is false, and the card
 * used to make it anyway — four comps all at $6.00 read as "the highest of the four" (adversarial
 * review, 2026-09-08, case D of `probe-comps-peer-set.mjs`). Equality is judged to within half a
 * cent (`RATE_EPSILON`), the same threshold the median delta calls "right at the median", so the
 * two clauses of one sentence can never contradict each other.
 * `{ rank, tiedWith, total }` — `rank` counts how many rates are strictly HIGHER, plus one, so every
 * member of a tied group shares one rank; `tiedWith` is how many OTHER comps hold that same rate. */
function rankAmong(featuredRate, peerRates) {
  const higher = peerRates.filter((r) => r - featuredRate > RATE_EPSILON).length;
  const tiedWith = peerRates.filter((r) => Math.abs(r - featuredRate) <= RATE_EPSILON).length;
  return { rank: higher + 1, tiedWith, total: peerRates.length + 1 };
}

function rankPhrase({ rank, tiedWith, total }) {
  if (tiedWith === 0) {
    if (rank === 1) return `the highest of the ${countWord(total)}`;
    if (rank === total) return `the lowest of the ${countWord(total)}`;
    return `${ordinalWord(rank)} highest of the ${countWord(total)}`;
  }
  // Every single comp carries the same rate — there is no ranking to report at all, so don't
  // manufacture one; say the only true thing.
  if (tiedWith === total - 1) return `level with all ${countWord(tiedWith)} of its peers`;
  if (rank === 1) return `tied for the highest of the ${countWord(total)}`;
  // The tied group runs to the bottom of the list, so it IS the lowest rate — shared, not held.
  if (rank + tiedWith === total) return `tied for the lowest of the ${countWord(total)}`;
  return `tied for ${ordinalWord(rank)} highest of the ${countWord(total)}`;
}

function deltaPhrase(delta) {
  const abs = Math.abs(delta);
  if (abs < RATE_EPSILON) return "right at the median";
  const dir = delta > 0 ? "above" : "below";
  if (abs < 1) {
    const cents = Math.round(abs * 100);
    return `${cents} cent${cents === 1 ? "" : "s"} ${dir} the median`;
  }
  return `$${abs.toFixed(2)} ${dir} the median`;
}

/** The one plain-English sentence naming where the featured comp lands among its peers, e.g.
 * "second highest of the eight, and five cents above the median for buildings over 500,000 SF in
 * Harris County, TX." Null whenever there's nothing honest to say — fewer than `MIN_PEERS_FOR_SCALE`
 * peers is the caller's own "peer set is too small" case, not this function's to word. `peerSet` is
 * a `buildPeerSet` result (so every rate in it is already on one scale); `featuredRate`/`compType`/
 * `countyLabel` are read off the featured comp. */
export function peerComparisonSentence({ featuredRate, peerSet, compType, countyLabel }) {
  const peers = peerSet?.peers || [];
  if (featuredRate == null || peers.length < MIN_PEERS_FOR_SCALE) return null;
  const peerRates = peers.map((p) => p.rate);
  const bandLabel = bandSentenceLabel(peerSet.band, compType);
  const standing = rankPhrase(rankAmong(featuredRate, peerRates));
  return `${standing}, and ${deltaPhrase(featuredRate - median(peerRates))} for ${bandLabel} in ${countyLabel}.`;
}

/** Pure geometry for the horizontal peer-comparison scale — every position a FRACTION (0..1) along
 * the low→high domain, never a pixel; the renderer scales fractions to whatever width it has. The
 * domain is the min/max of peers+featured TOGETHER, so the featured dot can never fall outside the
 * drawn rule even when it's the new high or low. A single-value domain (every rate identical)
 * centers everything rather than dividing by zero. */
export function compScaleLayout(featuredRate, peerRates) {
  const all = [...peerRates, featuredRate];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min;
  const frac = (v) => (span > 0 ? (v - min) / span : 0.5);
  return { min, max, peerFracs: peerRates.map(frac), featuredFrac: frac(featuredRate) };
}

/** A county routing key ("harris", "co_denver", "fort_bend" — see shared/CLAUDE.md's County
 * ROUTING KEYS note: a `co_` prefix means Colorado, no prefix means Texas) title-cased into a
 * proper display name ("Harris", "Denver", "Fort Bend") — no "County"/state suffix, so both this
 * module's own `countyLabel` (which appends " County, TX/CO") and any other caller that wants a
 * differently-suffixed form (e.g. the Dashboard feed's own "Harris County", B1407824) can build
 * their own sentence on top of ONE capitalization rule rather than each re-splitting the key. This
 * is deliberately a light, dependency-free formatter rather than a lookup into the full `COUNTIES`
 * GIS registry (site-planner/lib/counties.js) — that module is sized for the map workspace, not a
 * Dashboard card that loads on every visit, and every routing key this app mints already reads as
 * a plain county name once split on its underscore/prefix. `{ words, isColorado }` — `words` null
 * for no key / nothing left after splitting. */
export function countyNameWords(countyKey) {
  if (!countyKey) return { words: null, isColorado: false };
  const isColorado = countyKey.startsWith("co_");
  const raw = isColorado ? countyKey.slice(3) : countyKey;
  const words = raw.split(/[_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return { words: words.length ? words : null, isColorado };
}

/** A county routing key formatted as a short display name — "Harris County, TX" / "Denver County,
 * CO". Null for no key. See `countyNameWords` above for the capitalization rule this builds on. */
export function countyLabel(countyKey) {
  const { words, isColorado } = countyNameWords(countyKey);
  if (!words) return null;
  return `${words.join(" ")} County, ${isColorado ? "CO" : "TX"}`;
}

/** `countyLabel`'s pieces, shaped for `compLocationText.js`'s `pinFallbackText(anchor, countyEntry)`
 * — `{ name, state }`, matching its own `entry.name`/`entry.state` read exactly. */
export function countyEntry(countyKey) {
  const label = countyLabel(countyKey);
  if (!label) return null;
  const [name, state] = label.split(", ");
  return { name, state };
}

/** "today" / "1 day ago" / "N days ago" / "N months ago" — the same convention this Dashboard's
 * other cards already use (DashboardCards.jsx's own `relativeDays`), reproduced here so this pure
 * model has no dependency on a component file. */
export const relativeTimeLabel = daysAgoWords;

/** The most recently ADDED comp — `createdAt` ("Date entered," immutable), never `compDate` (the
 * deal's own Executed date, which can be backdated or left blank) — this card is about what's NEW
 * on the account, not what the deal date says. Null for an empty list. */
export function mostRecentlyAddedComp(comps) {
  if (!comps || !comps.length) return null;
  return [...comps].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
}

/** The whole card's derived data in one call — what the fetch layer hands the component.
 * `period` ("annual" | "monthly") is Michael's own toggle choice (persisted — see
 * `shared/comps/lib/compsRatePeriodPrefs.js`), defaulting to `DEFAULT_LEASE_PERIOD` for a brand
 * new account that has never touched it. */
export function buildCompsCardData(comps, period = DEFAULT_LEASE_PERIOD) {
  const featured = mostRecentlyAddedComp(comps);
  if (!featured) return { featured: null, total: 0 };
  const peerSet = buildPeerSet(comps, featured, period);
  const rate = compHeadlineRate(featured, period);
  const cLabel = countyLabel(featured.anchor?.county || null);
  const sentence = rate == null ? null : peerComparisonSentence({
    featuredRate: rate.value, peerSet, compType: featured.compType, countyLabel: cLabel,
  });
  return { featured, total: comps.length, peerSet, rate, countyLabel: cLabel, sentence };
}
