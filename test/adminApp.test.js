import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AdminApp from "../src/workspaces/admin/AdminApp.jsx";
import { SECTIONS } from "../src/workspaces/admin/lib/adminSections.js";

// B711904 / B711905-B711908 — the admin shell: a header + every section, in the order the owner acts on them.
describe("AdminApp — the sections", () => {
  it("declares the sections in action order: Issues, Reports, Support, Usage, … Ops last", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(["issues", "reports", "support", "usage", "signups", "criteria", "password-reset", "ops"]);
  });

  it("renders every section (its own test id) and a way back to the ordinary app", () => {
    const html = renderToStaticMarkup(createElement(AdminApp, { onExit: () => {} }));
    let last = -1;
    for (const s of SECTIONS) {
      const at = html.indexOf(`data-testid="admin-section-${s.id}"`);
      expect(at, s.id).toBeGreaterThan(last); // present AND in manifest order
      last = at;
    }
    expect(html).toMatch(/Back to Planyr/);
    expect(html).toMatch(/>Admin</);
  });

  it("no section is a 'Coming soon' placeholder any more", () => {
    const html = renderToStaticMarkup(createElement(AdminApp, { onExit: () => {} }));
    expect(html).not.toMatch(/Coming soon/);
  });

  it("the new sections open in a visible LOADING state (the RPC has not answered yet)", () => {
    const html = renderToStaticMarkup(createElement(AdminApp, { onExit: () => {} }));
    for (const id of ["issues", "support", "usage", "ops"]) {
      const start = html.indexOf(`data-testid="admin-section-${id}"`);
      expect(html.slice(start, start + 4500), id).toMatch(/Loading…/);
    }
  });
});
