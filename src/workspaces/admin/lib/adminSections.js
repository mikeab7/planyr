/* The admin page's sections, in nav order (NEW-1): Overview first, then the ones the owner acts on.
 * `id` is the hash sub-path (`#/admin/<id>`) AND the `admin-section-<id>` test id on each section's root.
 * Problem reports are merged into Support (same data, one place); Signup activity and the per-account
 * table are folded into Users. */
export const SECTIONS = [
  { id: "overview", title: "Overview", blurb: "Is anything wrong, and is anyone using it." },
  { id: "users", title: "Users", blurb: "Who has signed up and who is using it — counts and dates only, never their content." },
  { id: "issues", title: "Issues", blurb: "Production errors, grouped so one bug is one row." },
  { id: "support", title: "Support", blurb: "Reports filed from inside the app, as a queue." },
  { id: "usage", title: "Usage", blurb: "Totals and the 12-week trend." },
  { id: "criteria", title: "County requests", blurb: "Counties people asked criteria for." },
  { id: "parcel-coverage", title: "Parcel coverage", blurb: "Every county, parish or borough Planyr can answer a parcel click for, coloured by where its parcels come from." },
  { id: "password-reset", title: "Password reset", blurb: "Generate a new password for an account — no email involved." },
  { id: "ops", title: "Ops", blurb: "What is outstanding, and the state of Claude Code session clean-up." },
];
export const DEFAULT_SECTION = "overview";
export const PARCEL_COVERAGE_SECTION = SECTIONS.find((s) => s.id === "parcel-coverage");
