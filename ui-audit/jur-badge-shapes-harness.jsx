/* Dev-only harness (not part of the app build) for NEW-1 (B367296): the jurisdiction badge's four
 * canonical shapes, RENDERED.
 *
 * ⛔ WHY A BROWSER AT ALL, when `test/jurisdictionShapes.test.js` already pins the same strings: the
 * badge is a RENDERING SURFACE. A unit test cannot see a label that is clipped by the pill, wrapped
 * onto a second line, painted in a colour that fails contrast, or emptied because the component read
 * a field the formatter stopped returning. The owner's report was about what he SAW.
 *
 * Everything here is real: the real `identifyJurisdiction` chain over the real recorded agency
 * answers (shared with the CI suite via `ui-audit/lib/shapeReplay.js`), the real
 * `formatJurisdictionBadge`, the real `AppHeader`, the real `JurisdictionBadge` component. Only the
 * network is replaced. Served by `npm run dev`; driven by verify-jurisdiction-badge-shapes.mjs. */
import { createRoot } from "react-dom/client";
import AppHeader from "../src/shared/ui/AppHeader.jsx";
import { ThemeProvider } from "../src/shared/theme/ThemeProvider.jsx";
import JurisdictionBadge from "../src/workspaces/site-planner/components/JurisdictionBadge.jsx";
import { identifyJurisdiction, formatJurisdictionBadge } from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { feetToLatLngPair } from "../src/workspaces/site-planner/lib/mapLock.js";
import { representativeRing, ringCentroid } from "../src/workspaces/site-planner/lib/siteAnalysis.js";
import { replay, freshCache } from "./lib/shapeReplay.js";
import SHAPES from "../test/fixtures/jurisdictionShapes.json";
import PORTFOLIO from "../ui-audit/fixtures/jurisdiction-portfolio.json";

/* One CASE per shape the owner enumerated, plus the two states that are not shapes. `fail` drives a
 * role's lookup into an outage so the honest-unknown label is rendered too, not just described. */
const CASES = [
  { scope: "in-city", site: "Gessner", why: "1 · in city limits" },
  { scope: "in-city-etj", site: "Will Clayton", why: "2 · in city limits AND inside another city's ETJ" },
  { scope: "etj", site: "Bain", why: "3 · unincorporated inside an ETJ, with a city clipping the edge" },
  { scope: "etj-clean", site: "Kennedy Greens", why: "3 · the ETJ city ALSO clips the edge — one name, not two" },
  { scope: "split", site: "Goose Creek", why: "part in city limits, rest in that city's ETJ" },
  { scope: "unknown", site: "Bain", why: "the containment lookup could not answer", fail: ["city"] },
];

async function badgeFor(name, fail) {
  const rec = SHAPES.shapes.find((s) => s.site === name);
  const rings = PORTFOLIO.sites.find((p) => p.site === name).rings
    .map((r) => r.map(([x, y]) => { const [lat, lng] = feetToLatLngPair({ x, y }, rec.lat, rec.lon); return [lng, lat]; }));
  const rep = representativeRing(rings);
  const c = ringCentroid(rep);
  const j = await identifyJurisdiction(c.lng, c.lat, {
    ring: rep, rings, roles: ["county", "city", "etj"],
    cache: freshCache(), fetchJson: replay(rec, { fail: fail || [] }),
  });
  return { ...formatJurisdictionBadge(j), ageMs: 120000, sourceName: "TxDOT / TxGIO / H-GAC" };
}

const planCrumb = (
  <button data-testid="plan-crumb" style={{ display: "flex", alignItems: "center", gap: 5, height: 24, padding: "0 8px", borderRadius: 6, border: "none", background: "transparent", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", color: "var(--chrome-text)" }}>
    Plan A ▾
  </button>
);

function Case({ c, badge }) {
  return (
    <div data-scope={c.scope} data-shape={badge.shape || ""} style={{ marginBottom: 8 }}>
      <AppHeader
        module="site-planner"
        homeLabel="Map"
        currentProject={{ id: c.scope, name: c.site }}
        onSelectProject={() => {}}
        onNewProject={() => {}}
        planSlot={planCrumb}
        saveState="synced"
        multiEditOk
        centerContent={<JurisdictionBadge badge={badge} />}
        authControl={<button data-testid="auth-btn" style={{ height: 26, padding: "0 12px", borderRadius: 7, border: "1px solid var(--chrome-divider)", background: "var(--accent-site)", color: "var(--on-accent)", fontWeight: 700, fontSize: 12 }}>MM</button>}
        accountActive
        toolbarContent={<button style={{ fontSize: 12 }}>File ▾</button>}
      />
    </div>
  );
}

const badges = await Promise.all(CASES.map((c) => badgeFor(c.site, c.fail)));

createRoot(document.getElementById("root")).render(
  <ThemeProvider>
    {CASES.map((c, i) => <Case key={c.scope} c={c} badge={badges[i]} />)}
  </ThemeProvider>,
);
// The probe reads the rendered DOM; the badges are also published so a failure can be diagnosed
// against what the formatter actually returned rather than against a guess.
window.__BADGES__ = Object.fromEntries(CASES.map((c, i) => [c.scope, badges[i]]));
window.__READY__ = true;
