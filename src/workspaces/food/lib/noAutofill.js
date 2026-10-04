/* noAutofill — props that keep the phone from offering to fill a field from the contact card.
 *
 * iOS Safari (and Chrome/1Password-style fillers) decide a field is "a name / address / phone" from
 * its `autocomplete`, `name`, `id`, label and placeholder. A restaurant's name, a dish's name and a
 * free-text note are none of those, but "Name this place" / "Dish name" read as a person's name and
 * the phone offered his contact card. `autocomplete="off"` says so explicitly; a deliberately
 * non-contact `name` (never name/first/last/email/phone/address…) removes the heuristic's other
 * hook; the data-* flags are the password managers' documented opt-outs. Spread this on every
 * free-text field in the Food module and pass a descriptive, non-contact `name`. */
export function noAutofill(name) {
  return {
    name,
    autoComplete: "off",
    autoCorrect: "off",
    "data-lpignore": "true",
    "data-1p-ignore": "true",
    "data-form-type": "other",
  };
}
