import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AdminApp from "../src/workspaces/admin/AdminApp.jsx";
import { SECTIONS } from "../src/workspaces/admin/lib/adminSections.js";

// B711904 (NEW-1) — the admin shell itself: a header + the four section placeholders
// NEW-2..NEW-5 will fill in. Rendered directly (bypassing AdminGate), which is how
// AdminGate mounts it once access is confirmed.
describe("AdminApp — the four-section shell", () => {
  it("declares exactly the four named sections: Usage, Issues, Support, Ops", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(["usage", "issues", "support", "ops"]);
    expect(SECTIONS.map((s) => s.title)).toEqual(["Usage", "Issues", "Support", "Ops"]);
  });

  it("renders all four section titles and a way back to the ordinary app", () => {
    const html = renderToStaticMarkup(createElement(AdminApp, { onExit: () => {} }));
    for (const s of SECTIONS) expect(html).toContain(`>${s.title}<`);
    expect(html).toMatch(/Back to Planyr/);
    expect(html).toMatch(/>Admin</);
  });
});
