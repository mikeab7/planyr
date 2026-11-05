// Shared "leave this input alone" attributes for password managers / browser autofill.
//
// The problem (B865): with a password-manager extension installed (1Password, LastPass,
// Bitwarden, Dashlane…), clicking into a plain free-text editor — e.g. a date cell in the
// scheduling grid — makes the extension inject its inline icon into the field and pop an
// identity-autofill card ("Michael Butler"), which covers the cell and the rows below it.
// None of our inline cell editors are credential fields, so the autofill UI is pure noise.
//
// Spread NO_AUTOFILL onto every inline cell / free-text editor <input> so the extensions skip
// it. Each key targets a specific extension's opt-out attribute; together they cover the field:
//   - autoComplete:"x-planyr" a non-standard token (NOT "off" — iOS ignores "off"; see below)
//   - data-1p-ignore          1Password  — presence means "ignore"
//   - data-lpignore="true"    LastPass
//   - data-bwignore           Bitwarden  — presence means "ignore"
//   - data-form-type="other"  Dashlane / 1Password — "not a login/identity field"
//
// ⛔ NEVER spread this onto the auth/login/signup fields (AuthPanel) — real autofill must keep
// working there (the app WANTS 1Password to fill email/password on sign-in). Those inputs set
// their own semantic autoComplete tokens (email / current-password / new-password / given-name…)
// and are deliberately excluded.
//
// Spread it as the FIRST attribute (`<input {...NO_AUTOFILL} … />`) so any explicit prop that
// follows wins — it never clobbers an input's own autoComplete.
//
// The self-contained Sequence/Schedule iframe (public/sequence/index.html) can't import this
// module (it runs in-browser Babel with no bundler), so it defines a byte-identical copy inline;
// test/noAutofill.test.js guards the two against drift.
// ⛔ B2088384: `autocomplete="off"` is what iOS Safari IGNORES for its "AutoFill Contact" bar (measured
// on the owner's iPhone, B2046224 ×2), so the token is a deliberately NON-STANDARD one instead: browsers
// that honour the attribute read an unknown token as "no known kind of data". The app-wide
// shared/ui/phoneTyping.js stamps the same token on any field that has none.
//
// ⛔ NEW-1 (2026-10-16, owner, Chrome on Windows): a NON-standard token is the wrong answer on every browser EXCEPT
// iOS. Chrome reads an unknown token as "no opinion" and keeps its saved-entry (form history) dropdown — it offered
// "1502 FELLOWS", "10", "15"… under Site › Land › "Your name for it", all drawn from ONE history bucket because the app
// also stamped every nameless field with the same `name`. Chrome DOES honour `autocomplete="off"` for that history
// list, so off-iOS the token is "off" (and no shared `name` is stamped); iOS keeps `x-planyr` because it ignores "off".
export function isIosLike(nav = typeof navigator !== "undefined" ? navigator : undefined) {
  if (!nav) return false;
  return /iP(hone|ad|od)/.test(nav.userAgent || "") || (nav.platform === "MacIntel" && (nav.maxTouchPoints || 0) > 1);
}
/** The autocomplete value every non-contact field carries on THIS browser. */
export function autofillToken(nav) { return isIosLike(nav) ? "x-planyr" : "off"; }

export const NO_AUTOFILL = Object.freeze({
  autoComplete: autofillToken(),
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-bwignore": true,
  "data-form-type": "other",
});

// ⛔ B2308848 AMENDED (owner, 2026-10-17): browser suggestions STAY on fields that hold real-world contact / location
// info — an address, an email, a phone, a person's name, a company — where they genuinely help and other top apps offer
// them. Everything else (dimensions, depths, counts, labels, street label names, parcel / plan / site names, notes,
// filters) stays OFF, because those values are unique and suggesting them is pointless. DEFAULT IS OFF: nothing is a
// contact field unless it opts in HERE, explicitly, with the right standard token so Chrome offers the right thing.
// A field with a real token is left alone by the app-wide stamp (phoneTyping.js REAL_TOKEN), so this is the only edit
// a contact field needs. Planyr's own live-suggestion boxes (PlaceSearchField, PartyNameField) are NOT contact fields:
// their own dropdown would collide with Chrome's, so they stay "off".
export const CONTACT_TOKENS = Object.freeze({
  name: "name", email: "email", phone: "tel", company: "organization",
  street: "street-address", city: "address-level2", state: "address-level1", zip: "postal-code",
});
/** Attributes for a contact / location field. `kind` is a key of CONTACT_TOKENS. Spread it INSTEAD of NO_AUTOFILL. */
export function contactField(kind) {
  const autoComplete = CONTACT_TOKENS[kind];
  if (!autoComplete) throw new Error(`contactField: unknown kind "${kind}"`);
  return { autoComplete, "data-contact-field": "" };
}

export default NO_AUTOFILL;
