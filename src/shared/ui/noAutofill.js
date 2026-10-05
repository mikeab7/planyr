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
export const NO_AUTOFILL = Object.freeze({
  autoComplete: "x-planyr",
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-bwignore": true,
  "data-form-type": "other",
});

export default NO_AUTOFILL;
