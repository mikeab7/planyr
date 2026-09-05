/* Owner correction (adversarial review of B1156864, second message): `projects` handed to
 * CompForm is deliberately the PURSUIT-ONLY Sites list (MapFinder's own `siteGroups`), so a comp
 * whose `projectId` points at a "tracked" site (market intel only) could never match any
 * `<option>` — per the HTML select spec, a value matching no option silently renders the FIRST
 * option ("No project"). Measured live: all three of the owner's comps are correctly linked by
 * the migration to a tracked site, and all three read "No project" in this editor before the fix.
 * `CompForm` now also accepts `trackedSites` and offers them as visibly-labelled options so the
 * REAL owning site — tracked or not — always renders, never "No project" and never the bare
 * internal name "Market record".
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompForm } from "../src/shared/comps/components/CompsPanel.jsx";
import { emptyDraft } from "../src/shared/comps/lib/comps.js";

const PURSUIT_PROJECTS = [{ id: "real1", site: "Goose Creek" }];
const TRACKED_SITES = [{ id: "trk8eef7db4d0", site: "Core 5 - West Hardy" }];

const draftFor = (projectId) => ({ ...emptyDraft({ kind: "pin", lat: 29.99, lon: -95.4 }), compType: "lease", projectId });

const renderForm = (draft, extra = {}) => renderToStaticMarkup(createElement(CompForm, {
  draft, setDraft: () => {}, teams: [], projects: PURSUIT_PROJECTS, trackedSites: TRACKED_SITES,
  partyNames: [], errors: [], onSave: () => {}, onCancel: () => {}, saving: false, ...extra,
}));

describe("CompForm — the Project select must show a comp's REAL owning site, tracked or not", () => {
  it("a comp linked to a TRACKED site renders that site's real name as the selected option, never 'No project'", () => {
    const html = renderForm(draftFor("trk8eef7db4d0"));
    // React's SSR select-value handling marks the matching <option> `selected`.
    expect(html).toMatch(/<option[^>]*value="trk8eef7db4d0"[^>]*selected[^>]*>Core 5 - West Hardy \(market record\)<\/option>/);
    // "No project" must NOT be the one marked selected.
    expect(html).not.toMatch(/<option[^>]*value=""[^>]*selected[^>]*>No project<\/option>/);
  });

  it("a comp linked to an ordinary pursuit project still renders correctly (unaffected)", () => {
    const html = renderForm(draftFor("real1"));
    expect(html).toMatch(/<option[^>]*value="real1"[^>]*selected[^>]*>Goose Creek<\/option>/);
  });

  it("a comp with no project at all renders 'No project' selected, not a false attachment", () => {
    const html = renderForm(draftFor(null));
    expect(html).toMatch(/<option[^>]*value=""[^>]*selected[^>]*>No project<\/option>/);
  });

  it("the select still renders when there are ZERO pursuit projects but a tracked site exists", () => {
    const html = renderForm(draftFor("trk8eef7db4d0"), { projects: [] });
    expect(html).toMatch(/Core 5 - West Hardy \(market record\)/);
  });

  it("a tracked option's label is always visibly distinct from a pursuit one (never plain, never 'Market record')", () => {
    const html = renderForm(draftFor(null));
    expect(html).toContain("Core 5 - West Hardy (market record)");
    expect(html).not.toContain(">Market record<");
  });
});
