# Owner product constraint #16

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

16. **(2026-10-11, supersedes the 2026-10-05 half-step wording) Food ratings are one slider each, 1 to 10 in quarter steps, and
    must not be replaced with tap buttons, steppers, +/- nudges or whole numbers without Michael's say-so.** EVERY rating in /food
    — a visit's Food, its Ambiance and each dish's score — is the SAME component (`components/RatingSlider.jsx`: min 1, max 10,
    step 0.25, "Not rated" until touched, one readout pill, Clear to its right, whole-number ticks 1-10 centred under the thumb,
    the whole row a grab target). The scale lives in `src/workspaces/food/lib/ratingScale.js`; `test/foodRatingSlider.test.js`
    fails if the range or step changes or a tap grid/stepper returns. Ratings saved in halves or whole numbers still display as
    saved. (History: quarter steps shipped 2026-08-28; PR #2001 re-locked only the restaurant slider to halves; B626576 / NEW-1.)
