/* Canonical default project folder template (B650; replaced v1 → v2 in B1238864, v2 → v3 in
 * B1262592).
 *
 * Every Planyr project is scaffolded from THIS one template — the empty folder skeleton a
 * generic industrial-development deal uses. It is the single source of truth for the default
 * structure: scaffolding (folderStore.seedProject), the Drive mirror, and the drift/"reset to
 * template" affordance all read it here.
 *
 * ── v3 (B1262592, 2026-09-06) — replaced v2, same day, STILL LIVE UNDER OWNER ITERATION ────────
 * Owner correction, verbatim: *"let's get rid of the sustainability folder and let's lump
 * entity stuff. Let's make, like, the number one folder, the... just called organization and
 * lump and legal entity marketing all that kind of stuff into it."* Then, minutes later, a second
 * pass: *"financing should be in the top level organization folder too."* This entry describes
 * the CURRENT shape after both passes — don't read the two as separate revisions, and expect
 * more amendments before this settles (the owner is iterating live; nothing has shipped/seeded
 * off this shape yet, so `TEMPLATE_VERSION` stays 3 across these in-flight edits rather than
 * bumping per tweak).
 *  • **`06. Sustainability` is DELETED entirely** (Correspondence, Contracts, Scorecards &
 *    Budgets, Certification - LEED all go with it) — no real project had used it.
 *  • **NEW `01. Organization`** absorbs the old top-level `01. Deal`, `03. Entity & Legal`,
 *    `08. Financing`, and `09. Marketing & Leasing` as its own four children (Financing placed
 *    third, ahead of Marketing & Leasing — "you finance before you lease," so the folders read in
 *    lifecycle order; this ordering call is not the owner's own words and is trivial to swap if
 *    he wants it otherwise), each keeping its full former subtree unchanged underneath. TEN
 *    top-level categories become SIX: Organization, Land (`02.`, untouched), Entitlements &
 *    Approvals (`03.`, untouched), **Design `05.` → `04.`**, Construction `07.` → `05.`,
 *    Close-Out `10.` → `06.`. There is no standalone Financing folder at top level any more.
 *  • Judgment calls the owner made room to overrule, so don't treat any as load-bearing:
 *    (a) Organization is GROUPED one level deep (Deal / Entity & Legal / Financing / Marketing &
 *    Leasing) rather than flattened into one grab bag — a flat list recreates exactly the v1
 *    problem v2 was built to remove. (b) Marketing & Leasing and Financing both landed inside
 *    Organization because the owner's own phrasing grouped them with "legal entity" stuff; either
 *    is one word away from being its own sibling top-level category again. (c) Financing-before-
 *    Marketing ordering, above, is the session's call, not his.
 *  • Depth ceiling is UNCHANGED and re-checked after every pass since this is the hard rule that
 *    must not slip while the tree is still moving: the deepest paths are `01. Organization/
 *    02. Entity & Legal/06. Insurance/01. Builders Risk` and `04. Design/01. Drawings/
 *    03. Architectural/01. Current`, both exactly depth 3 (four levels). Nothing may go deeper.
 *
 * ── v3, third pass (still B1262592, same day) — `04. Marketing & Leasing` split, APPROVED ───────
 * Owner asked whether a tenant-prospect/pursuit folder existed; it didn't. His answer once the
 * gap was named: *"there should at least be a pursuit one, but you're right... we also need to
 * track leases and LOIs"* and *"you don't need to have a folder for each tenant that comes as we
 * build it"* — so the pursuit/executed split is IN, per-tenant subfolders are OUT of the template
 * (created by hand as tenants appear, not scaffolded), and — his words — apply *"whatever another
 * developer would do for the tenant folder, obviously"* rather than inventing something novel.
 * `04. Marketing & Leasing` goes from 4 children to 7, in lifecycle order — market it, chase it,
 * sign it, pay the broker, prove it to the lender:
 *   `01. Marketing` · `02. Media` · `03. Photos` · `04. Tenant Pursuits` · `05. Leases & LOIs` ·
 *   `06. Broker Agreements & Commissions` · `07. Estoppels & SNDAs`.
 * **`04. Tenant Pursuits` / `05. Leases & LOIs` is a DISCLOSURE BOUNDARY, not a tidiness split —
 * do not "simplify" it back into one folder.** In diligence you hand a lender or buyer
 * `Leases & LOIs`; you cannot hand them `Tenant Pursuits` — it holds pricing strategy, what
 * competing prospects were offered, and candid broker traffic. The two also behave on different
 * clocks: pursuit material churns weekly and mostly dies with the deal that didn't happen;
 * executed leases are append-only and get pulled again at sale, refinance, and audit, years later.
 * **`06. Broker Agreements & Commissions` and `07. Estoppels & SNDAs` are additions beyond the
 * owner's literal ask, not smuggled in — both are standard in a developer's leasing file and had
 * NO home anywhere in the template before this** (a commission agreement would have landed in
 * `02. Entity & Legal/05. Legal` by default, an estoppel would have landed nowhere at all). Drop
 * either without argument if the owner strikes it.
 * **`Tenant Improvements` is deliberately NOT here.** TI is construction work, not a leasing
 * record — it belongs under `05. Construction` alongside contracts and change orders; do not
 * create a TI folder under Marketing & Leasing even though "tenant" is in both names.
 * Depth is untouched (`04. Marketing & Leasing`'s children sit at depth 2 — three levels — same
 * as before the split; the four-level ceiling elsewhere is unaffected and there is room under any
 * of these seven for a future `01. Current`/`02. Archive` pair if the owner asks, but none is
 * added speculatively).
 * 118 folders total (was 115; the 4→7-child Marketing & Leasing split adds 3), max depth 4,
 * 6 top-level. `TEMPLATE_VERSION` stays 3 — nothing has shipped/seeded off any v3 shape yet.
 *
 * ── v2 (B1238864, 2026-09-06) — replaced v1 ──────────────────────────────────────────────────
 * v1 shipped a top-level `01. Hillwood` category: Michael's own employer's internal deal-folder
 * standard, hard-coded into a product he demos to people who don't work there — wrong for any
 * user who isn't Hillwood, and it's what happens when a template is authored FROM one company's
 * org chart instead of from the deal lifecycle itself. v1 was also a 20-child grab bag under
 * that one category, ran five levels deep, and duplicated categories the rest of the tree
 * already covered twice over (Financing at both `01.20` and `07`; Permits at both `04.02` and
 * `11.02`). v2 fixed all three at once, with ten top-level categories ordered by the deal
 * lifecycle. (Superseded by v3 above the same day — kept here for history.)
 *  • `12. Bldg Acq` (v1) shipped empty and was never used by any real project — dropped, not
 *    carried forward under a new name.
 *
 * ── Rules baked in (per the B650 brief, carried forward unchanged) ────────────────────────────
 *  • Names carry a ZERO-PADDED two-digit prefix + period + space ("01. ", … "12. "). The
 *    padding is REQUIRED, not cosmetic: Drive web/mobile sort names as plain text, so an
 *    un-padded "1., 10., 2." would sort wrong. Keep the padding when adding new levels.
 *  • "01. Current" / "02. Archive" — deliberately NOT "superseded" (too much AEC jargon);
 *    numbered so Current sorts above Archive.
 *  • Each new project is an INDEPENDENT COPY. Editing a project later never touches this
 *    template; editing this template only affects projects created AFTERWARD (it must
 *    never retroactively restructure an existing project — see folderStore.seedProject,
 *    which seeds once and never re-applies). **B1238865 is the one deliberate, one-time
 *    exception**: a project-wide re-scaffold onto v2, run once, by hand, for every project that
 *    existed when v2 shipped — never a standing behavior a template edit triggers on its own.
 *
 * Shape: a nested array of { name, children? }. Pure data — no ids, no Drive, no Supabase.
 * `flattenTemplate` (folderTree.js) turns it into orderable rows the store/mirror use.
 */

// The Current/Archive pair every "Drawings" discipline subfolder holds. Kept as a helper so the
// pair is defined once.
const currentArchive = () => [{ name: "01. Current" }, { name: "02. Archive" }];
const discipline = (name) => ({ name, children: currentArchive() });

export const TEMPLATE_VERSION = 3;

export const FOLDER_TEMPLATE = [
  { name: "01. Organization", children: [
    { name: "01. Deal", children: [
      { name: "01. Correspondence" },
      { name: "02. Investment Summary" },
      { name: "03. Pursuit Budgets" },
      { name: "04. Development Budgets" },
      { name: "05. Financial Models" },
      { name: "06. Development Schedule" },
      { name: "07. Development Checklist" },
      { name: "08. Market Research" },
      { name: "09. Project Directory" },
    ]},
    { name: "02. Entity & Legal", children: [
      { name: "01. Entity Docs - SPE" },
      { name: "02. Joint Venture" },
      { name: "03. Ground Lease" },
      { name: "04. CCRs - Park Association" },
      { name: "05. Legal" },
      { name: "06. Insurance", children: [
        { name: "01. Builders Risk" },
        { name: "02. Certs of Insurance" },
        { name: "03. Factory Mutual" },
      ]},
    ]},
    { name: "03. Financing", children: [
      { name: "01. Correspondence" },
      { name: "02. Loan Closing Checklist" },
      { name: "03. Draw Requests" },
      { name: "04. Lender's Inspector" },
      { name: "05. Appraisals" },
      { name: "06. Tax Certs" },
      { name: "07. Alternative Financing" },
    ]},
    { name: "04. Marketing & Leasing", children: [
      { name: "01. Marketing" },
      { name: "02. Media" },
      { name: "03. Photos" },
      { name: "04. Tenant Pursuits" },
      { name: "05. Leases & LOIs" },
      { name: "06. Broker Agreements & Commissions" },
      { name: "07. Estoppels & SNDAs" },
    ]},
  ]},
  { name: "02. Land", children: [
    { name: "01. Purchase & Sale Agreements" },
    { name: "02. Title Commitment & Review" },
    { name: "03. Survey & Legal Descriptions" },
    { name: "04. Plat & Easements" },
    { name: "05. Deed & Closing Documents" },
    { name: "06. Ag Lease" },
    { name: "07. Seller Due Diligence" },
    { name: "08. Environmental" },
    { name: "09. Geotech" },
    { name: "10. Floodplain - FEMA" },
    { name: "11. Wetlands & Streams" },
  ]},
  { name: "03. Entitlements & Approvals", children: [
    { name: "01. Correspondence" },
    { name: "02. Zoning" },
    { name: "03. Permits" },
    { name: "04. Development Agreement" },
    { name: "05. DRC Meetings" },
    { name: "06. Fees, Taxes & Incentives" },
    { name: "07. Ordinances" },
    { name: "08. Fire Department" },
    { name: "09. Energy Code - COMcheck" },
    { name: "10. Utilities", children: [
      { name: "01. Correspondence" },
      { name: "02. Electric" },
      { name: "03. Gas" },
      { name: "04. Water" },
      { name: "05. Sewer" },
      { name: "06. Telecom" },
    ]},
  ]},
  { name: "04. Design", children: [
    { name: "01. Drawings", children: [
      discipline("01. Exhibits"),
      discipline("02. Site Plans"),
      discipline("03. Architectural"),
      discipline("04. Structural"),
      discipline("05. Civil"),
      discipline("06. Landscape"),
      discipline("07. MEP"),
    ]},
    { name: "02. Specifications" },
    { name: "03. Reports & Studies" },
    { name: "04. Consultant Contracts" },
    { name: "05. Correspondence" },
    { name: "06. Invoices" },
  ]},
  { name: "05. Construction", children: [
    { name: "01. Correspondence" },
    { name: "02. Preliminary Pricing" },
    { name: "03. Bids" },
    { name: "04. Contracts & Change Orders" },
    { name: "05. Pay Apps & Invoices" },
    { name: "06. Meeting Minutes" },
    { name: "07. Schedules" },
    { name: "08. Submittals" },
    { name: "09. Safety" },
    { name: "10. Monthly Reports" },
    { name: "11. Weather Logs" },
    { name: "12. Testing & Inspections", children: [
      { name: "01. Contract" },
      { name: "02. Reports" },
    ]},
  ]},
  { name: "06. Close-Out", children: [
    { name: "01. Project Team" },
    { name: "02. Permits & Acceptance Letters" },
    { name: "03. As-Builts - Arch, Civil, Struct, MEP" },
    { name: "04. Construction Documents" },
    { name: "05. Warranties" },
    { name: "06. O&M Info" },
    { name: "07. Property Mgmt Support Docs" },
    { name: "08. Lessons Learned" },
  ]},
];
