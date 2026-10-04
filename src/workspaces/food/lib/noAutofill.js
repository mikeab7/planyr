/* noAutofill — props that keep the phone from offering to fill a field from the contact card.
 *
 * iOS Safari (and Chrome/1Password-style fillers) decide a field is "a name / address / phone" from
 * its `autocomplete`, `name`, `id`, label, aria-label and placeholder. A restaurant's name, a dish's
 * name and a free-text note are none of those, but "Name this place" / "Dish name" read as a
 * person's name and the phone offered his contact card.
 *
 * ⛔ RECURRENCE (B2046224 ×2, 2026-10-04 — owner, real iPhone, "+ Add a dish" still showed "AutoFill
 * Contact" with his own name). The first version relied on `autocomplete="off"`, which iOS Safari
 * largely ignores for contact AutoFill, and it named the dish field "dish-title" — "title" is a
 * contact-card field (job title) — under a placeholder that said "Dish name". Now:
 *  · the autocomplete token is a deliberately NON-STANDARD one (`x-food-<name>`): browsers that honour
 *    the attribute treat an unknown token as "no known kind of data", unlike "off", which iOS overrides;
 *  · the `name` must avoid every contact word (CONTACT_WORDS below — "title" included) — this throws
 *    rather than shipping a field iOS will offer to fill;
 *  · the wording AROUND the field (placeholder, aria-label, label) must avoid them too — enforced by
 *    test/foodPhone.test.js's sweep and ui-audit/verify-food-ios-keyboard.mjs §7, not by this helper.
 * The data-* flags are the password managers' documented opt-outs. Spread this on every free-text
 * field in the Food module and pass a descriptive, non-contact `name`. */
export const CONTACT_WORDS = /(^|[^a-z])(name|title|first|last|full|given|family|nick|e-?mail|phone|tel|mobile|address|street|city|state|zip|postal|org|organi[sz]ation|company|job|contact|country|birthday|bday)([^a-z]|$)/i;

export function noAutofill(name) {
  if (CONTACT_WORDS.test(name)) throw new Error(`noAutofill: "${name}" contains a contact-card word iOS AutoFill keys off`);
  return {
    name,
    autoComplete: `x-food-${name}`,
    autoCorrect: "off",
    "data-lpignore": "true",
    "data-1p-ignore": "true",
    "data-form-type": "other",
  };
}
