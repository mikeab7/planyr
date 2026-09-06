/* Canonical default project folder template (B650; replaced v1 → v2 in B1238864).
 *
 * Every Planyr project is scaffolded from THIS one template — the empty folder skeleton a
 * generic industrial-development deal uses. It is the single source of truth for the default
 * structure: scaffolding (folderStore.seedProject), the Drive mirror, and the drift/"reset to
 * template" affordance all read it here.
 *
 * ── v2 (B1238864, 2026-09-06) — replaced v1 ──────────────────────────────────────────────────
 * v1 shipped a top-level `01. Hillwood` category: Michael's own employer's internal deal-folder
 * standard, hard-coded into a product he demos to people who don't work there — wrong for any
 * user who isn't Hillwood, and it's what happens when a template is authored FROM one company's
 * org chart instead of from the deal lifecycle itself. v1 was also a 20-child grab bag under
 * that one category, ran five levels deep, and duplicated categories the rest of the tree
 * already covered twice over (Financing at both `01.20` and `07`; Permits at both `04.02` and
 * `11.02`). v2 fixes all three at once:
 *  • TEN top-level categories, ordered by the DEAL LIFECYCLE (Deal → Land → Entity & Legal →
 *    Entitlements → Design → Sustainability → Construction → Financing → Marketing & Leasing →
 *    Close-Out) rather than by any one company's internal folder standard.
 *  • Maximum FOUR levels deep (was five — B650's own `01. Drawings/<discipline>/Current|Archive`
 *    shape is the deepest surviving case, at depth 3 from its own top-level category).
 *  • Each category owns its topic exactly once — Financing lives only under `08. Financing`,
 *    Permits only under `04. Entitlements & Approvals`.
 *  • **NOTHING IN THIS TEMPLATE MAY NAME A COMPANY.** That is the whole point of the rewrite —
 *    keep it that way when extending any category.
 *  • `12. Bldg Acq` (v1) shipped empty and was never used by any real project — dropped, not
 *    carried forward under a new name.
 * 119 folders total, max depth 4, 10 top-level. `TEMPLATE_VERSION` bumped 1 → 2 so existing
 * per-project rows (seeded from v1) are distinguishable from anything seeded after this change.
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

export const TEMPLATE_VERSION = 2;

export const FOLDER_TEMPLATE = [
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
  { name: "03. Entity & Legal", children: [
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
  { name: "04. Entitlements & Approvals", children: [
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
  { name: "05. Design", children: [
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
  { name: "06. Sustainability", children: [
    { name: "01. Correspondence" },
    { name: "02. Contracts" },
    { name: "03. Scorecards & Budgets" },
    { name: "04. Certification - LEED" },
  ]},
  { name: "07. Construction", children: [
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
  { name: "08. Financing", children: [
    { name: "01. Correspondence" },
    { name: "02. Loan Closing Checklist" },
    { name: "03. Draw Requests" },
    { name: "04. Lender's Inspector" },
    { name: "05. Appraisals" },
    { name: "06. Tax Certs" },
    { name: "07. Alternative Financing" },
  ]},
  { name: "09. Marketing & Leasing", children: [
    { name: "01. Marketing" },
    { name: "02. Media" },
    { name: "03. Photos" },
    { name: "04. Leases & LOIs" },
  ]},
  { name: "10. Close-Out", children: [
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
