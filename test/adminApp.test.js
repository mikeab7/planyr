import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AdminApp from "../src/workspaces/admin/AdminApp.jsx";
import { SECTIONS } from "../src/workspaces/admin/lib/adminSections.js";

// B711904 / B711905-B711908 — the admin shell: a header + every section, in the order the owner acts on them.
describe("AdminApp — the sections", () => {
  it("declares the sections in nav order: Overview, Users, Issues, Support, Usage, County requests, Parcel coverage, Password reset, Ops", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(["overview", "users", "issues", "support", "usage", "criteria", "parcel-coverage", "password-reset", "ops"]);
  });

  it("opens on Overview (one section at a time), with a nav entry for every section and a way back to the ordinary app", () => {
    const html = renderToStaticMarkup(createElement(AdminApp, { onExit: () => {} }));
    expect(html).toContain('data-testid="admin-section-overview"');
    expect(html.match(/data-testid="admin-section-/g)).toHaveLength(1);
    for (const s of SECTIONS) expect(html, s.id).toContain(`data-testid="admin-nav-${s.id}"`);
    expect(html).toMatch(/Back to Planyr/);
    expect(html).toMatch(/>Admin</);
  });

  it("no section is a 'Coming soon' placeholder", () => {
    expect(renderToStaticMarkup(createElement(AdminApp, { onExit: () => {} }))).not.toMatch(/Coming soon/);
  });

  it("the data-driven Overview opens in a visible LOADING state (the RPCs have not answered yet)", () => {
    expect(renderToStaticMarkup(createElement(AdminApp, { onExit: () => {} }))).toMatch(/Loading…/);
  });
});
