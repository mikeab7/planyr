/* The admin page's sections, in the order they render (NEW-1, B711905–B711908): the ones the owner
 * acts on come first. `id` matches the `admin-section-<id>` test id on each section's root. The
 * four former placeholders (Usage, Issues, Support, Ops) are real sections now. */
export const SECTIONS = [
  { id: "issues", title: "Issues" },
  { id: "reports", title: "Problem reports" },
  { id: "support", title: "Support" },
  { id: "usage", title: "Usage" },
  { id: "signups", title: "Signup activity" },
  { id: "criteria", title: "County criteria requests" },
  { id: "password-reset", title: "Admin password reset" },
  { id: "ops", title: "Ops" },
];
