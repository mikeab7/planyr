/* Canonical default project folder template (B650).
 *
 * Every Planyr project is scaffolded from THIS one template — the full empty folder
 * skeleton the owner uses for an industrial development deal. It is the single source of
 * truth for the default structure: scaffolding (folderStore.seedProject), the Drive
 * mirror, and the drift/"reset to template" affordance all read it here.
 *
 * ── Rules baked in (per the B650 brief) ────────────────────────────────────────────────
 *  • Names carry a ZERO-PADDED two-digit prefix + period + space ("01. ", … "20. "). The
 *    padding is REQUIRED, not cosmetic: Drive web/mobile sort names as plain text, so an
 *    un-padded "1., 10., 2." would sort wrong. Keep the padding when adding new levels.
 *  • "01. Current" / "02. Archive" — deliberately NOT "superseded" (too much AEC jargon);
 *    numbered so Current sorts above Archive.
 *  • Each new project is an INDEPENDENT COPY. Editing a project later never touches this
 *    template; editing this template only affects projects created AFTERWARD (it must
 *    never retroactively restructure an existing project — see folderStore.seedProject,
 *    which seeds once and never re-applies).
 *  • Ship scope / known gaps (do NOT treat as bugs): three categories ship intentionally
 *    short + user-extensible — Land (01–13; 14–18 were unknown at authoring), Close-Out
 *    (01–10; 11 unknown), Bldg Acq (empty; contents unknown).
 *
 * Shape: a nested array of { name, children? }. Pure data — no ids, no Drive, no Supabase.
 * `flattenTemplate` (folderTree.js) turns it into orderable rows the store/mirror use.
 */

// The nine engineering-discipline subfolders under 02. Design → 01. Drawings, each of which
// holds 01. Current + 02. Archive. Kept as a helper so the Current/Archive pair is defined once.
const currentArchive = () => [{ name: "01. Current" }, { name: "02. Archive" }];
const discipline = (name) => ({ name, children: currentArchive() });

export const TEMPLATE_VERSION = 1;

export const FOLDER_TEMPLATE = [
  {
    name: "01. Hillwood",
    children: [
      { name: "01. Correspondence" },
      { name: "02. Project Directory & Invoices" },
      { name: "03. Development Schedule" },
      { name: "04. Outline Specifications" },
      { name: "05. Pursuit Budgets" },
      { name: "06. Development Budgets" },
      { name: "07. Financial Models" },
      { name: "08. Media" },
      { name: "09. Development Checklist" },
      { name: "10. DPO - Investment Summary" },
      { name: "11. Purchase & Sale Agreements" },
      { name: "12. Ground Lease" },
      { name: "13. Entity Docs - SPE" },
      { name: "14. Joint Venture" },
      { name: "15. Photos" },
      { name: "16. Legal" },
      { name: "17. Market Research" },
      { name: "18. Marketing" },
      { name: "19. Approvals" },
      { name: "20. Financing" },
    ],
  },
  {
    name: "02. Design",
    children: [
      {
        name: "01. Drawings",
        children: [
          discipline("01. Exhibits"),
          discipline("02. Site Plans"),
          discipline("03. Architectural"),
          discipline("04. Structural"),
          discipline("05. Civil"),
          discipline("06. Landscape"),
          discipline("07. Mechanical"),
          discipline("08. Electrical"),
          discipline("09. Plumbing"),
        ],
      },
      // Specifications is a SIBLING of Drawings, not nested inside it.
      { name: "02. Specifications" },
      { name: "03. Contracts" },
      { name: "04. Reports & Studies" },
      { name: "05. Correspondence" },
      { name: "06. Invoices" },
    ],
  },
  {
    name: "03. Sustainability",
    children: [
      { name: "01. Correspondence" },
      { name: "02. Contracts" },
      { name: "03. Scorecards & Budgets" },
      { name: "04. LEED" },
    ],
  },
  {
    name: "04. Governmental",
    children: [
      { name: "01. Correspondence" },
      { name: "02. Permits" },
      { name: "03. Zoning" },
      { name: "04. DRC Meeting" },
      { name: "05. Economic Development" },
      { name: "06. Impact Fees" },
      { name: "07. Ordinances" },
      { name: "08. Development Agreement" },
      { name: "09. Energy Code - COMcheck" },
      { name: "10. Fire Department" },
      { name: "11. OpEx" },
      { name: "12. Taxes - Incentives" },
    ],
  },
  {
    name: "05. General Contractor",
    children: [
      { name: "01. Correspondence" },
      { name: "02. Preliminary Pricing" },
      { name: "03. Bids" },
      { name: "04. Contracts & Change Orders" },
      { name: "05. Pay Apps & Invoices" },
      { name: "06. Meeting Minutes" },
      { name: "07. Schedules" },
      { name: "08. Safety" },
      { name: "09. Submittals" },
      { name: "10. Monthly Reports" },
      { name: "11. Weather Logs" },
    ],
  },
  {
    name: "06. Insurance",
    children: [
      { name: "01. Builders Risk" },
      { name: "02. Certs of Insurance" },
      { name: "03. Factory Mutual" },
    ],
  },
  {
    name: "07. Financing",
    children: [
      { name: "01. Correspondence" },
      { name: "02. Lender's Inspector" },
      { name: "03. Draw Requests" },
      { name: "04. Tax Certs" },
      { name: "05. Appraisals" },
      { name: "06. Loan Closing Checklist" },
      { name: "07. Alternative Financing" },
    ],
  },
  {
    name: "08. Land",
    children: [
      { name: "01. Seller Due Diligence" },
      { name: "02. CCRs - Park Assoc" },
      { name: "03. Closing Stmts" },
      { name: "04. Geotech Rpt" },
      { name: "05. Environmental" },
      { name: "06. Wetland - Stream" },
      { name: "07. Flood Plain - FEMA" },
      { name: "08. Survey & Legal Descriptions" },
      { name: "09. Plat & Easements" },
      { name: "10. Special Warranty Deed" },
      { name: "11. Title Rev - Commitment" },
      { name: "12. Ag Lease" },
      { name: "13. Labor Study" },
    ],
  },
  {
    name: "09. Testing Contractor",
    children: [
      { name: "01. Contract" },
      { name: "02. Reports" },
    ],
  },
  {
    name: "10. Utilities",
    children: [
      { name: "01. Correspondence" },
      { name: "02. Electric" },
      { name: "03. Gas" },
      { name: "04. Water" },
      { name: "05. Sewer" },
      { name: "06. Telecom" },
    ],
  },
  {
    name: "11. Close-Out",
    children: [
      { name: "01. Proj Team" },
      { name: "02. Permits" },
      { name: "03. Inspections - Acceptance Ltrs" },
      { name: "04. Documents" },
      { name: "05. Arch - Civil - Struc - MEP" },
      { name: "06. Construction" },
      { name: "07. Warranties" },
      { name: "08. O&M Info" },
      { name: "09. Prop Mgmt Support Docs" },
      { name: "10. Lessons Learned" },
    ],
  },
  // 12. Bldg Acq ships as an empty top-level category (no subfolders defined).
  { name: "12. Bldg Acq" },
];
