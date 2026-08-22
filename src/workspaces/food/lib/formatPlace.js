/* formatPlace — DISPLAY-ONLY formatting for a place's category and address. The stored value
 * (Overture's raw snake_case category, the raw comma-joined address) is never mutated — these
 * are presentation concerns only, so matching/filtering/search still work against the raw text.
 *
 * ⛔ CATEGORY CASING (B634977, owner, 2026-08-19: the panel showed "japanese restaurant" — "let's change
 * that to be normal 'Japanese Restaurant'"). Overture's `category` is snake_case
 * ("japanese_restaurant"); this title-cases each word, with a small exception list so it
 * doesn't produce nonsense out of a real acronym. Checked every one of the 202 distinct category
 * values actually present in production before writing the rule, rather than assuming the shape
 * (Grep the DISTINCT_CATEGORIES_CHECKED note below) — the only genuine acronym found is DIY
 * ("diy_foods_restaurant"). "BBQ"/"BYOB" do NOT actually occur — Overture spells barbecue out in
 * full ("barbecue_restaurant") — but both stay in the exception list defensively, at zero cost,
 * in case a future load ever adds a category that does use them. Minor connector words
 * ("and", "of") are lower-cased when not the first word, so "eat_and_drink" reads "Eat and
 * Drink" and "bar_and_grill_restaurant" reads "Bar and Grill Restaurant" rather than the
 * naive "Eat And Drink".
 *
 * DISTINCT_CATEGORIES_CHECKED (2026-08-19, `select distinct category from food_places`, 202
 * rows): the full list is restaurant/bar/shop/etc. category names, every one a real word or
 * ordinary compound (mexican_restaurant, sports_bar, ice_cream_shop, …) except diy_foods_restaurant.
 */
const ACRONYMS = new Set(["bbq", "byob", "diy"]);
const LOWERCASE_MINOR = new Set(["and", "of", "the", "a", "an", "or"]);

export function formatCategory(category) {
  if (!category) return null;
  const words = category.split("_").filter(Boolean);
  if (!words.length) return null;
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      if (i > 0 && LOWERCASE_MINOR.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/* ⛔ ADDRESS TIDY (owner, 2026-08-19, "minor, same line, only if trivial"). Overture's address
 * always ends "..., <STATE>, <ZIP>" or "..., <STATE>, <ZIP>-<PLUS4>" (checked 25 real production
 * addresses before writing this). Trims the ZIP+4 suffix and the comma before it, so
 * "224 Westheimer Rd, Houston, TX, 77006-3222" reads "224 Westheimer Rd, Houston, TX 77006".
 * Only touches a trailing ", <5-digit-zip>[-4digit]" — an address that doesn't end that way
 * (no match) is returned unchanged, so this can never mangle a format it wasn't built for. */
export function formatAddress(address) {
  if (!address) return null;
  return address.replace(/,\s*(\d{5})(-\d{4})?\s*$/, " $1");
}

/* ⛔ CITY EXTRACTION (NEW-2, owner: header line 2 should read "French Restaurant · River Oaks" —
 * category then "the neighbourhood or city if the address gives you one"). Overture has no
 * separate neighbourhood field on food_places, so this reads the CITY out of the address's own
 * comma-separated shape instead: "<street>, <city>, <state> <zip>" -> the second segment. Costs
 * nothing extra to compute (the address is already loaded with the place) and never mutates the
 * stored value, same DISPLAY-ONLY principle as formatCategory/formatAddress above. Returns null
 * for anything that doesn't have at least two comma-separated segments, rather than guessing. */
export function formatCityFromAddress(address) {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1] : null;
}
