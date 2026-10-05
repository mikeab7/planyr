/* The four admin page sections (B711904 / NEW-1). Each is an empty placeholder here;
 * NEW-2 (Usage, B711905), NEW-3 (Issues, B711906), NEW-4 (Support, B711907) and NEW-5
 * (Ops, B711908) fill these in without touching AdminApp.jsx's layout. */
export const SECTIONS = [
  { id: "usage", title: "Usage", blurb: "Sign-ins, active users, plan activity over time. Coming soon." },
  { id: "issues", title: "Issues", blurb: "Grouped production errors from client_errors. Coming soon." },
  { id: "support", title: "Support", blurb: "Help tickets filed from inside the app. Coming soon." },
  { id: "ops", title: "Ops", blurb: "Outstanding backlog items and Claude Code session status. Coming soon." },
];

/* NEW-1 — the parcel-coverage map. Unlike the four placeholders above it is a real section
 * (like CriteriaRequests / Reports / SignupActivity it is mounted by AdminApp with its own
 * component, so it is NOT in SECTIONS, whose four-id shape test/adminApp.test.js pins). */
export const PARCEL_COVERAGE_SECTION = {
  id: "parcel-coverage",
  title: "Parcel coverage",
  blurb: "Every county, parish or borough Planyr can answer a parcel click for, coloured by where its parcels come from.",
};
