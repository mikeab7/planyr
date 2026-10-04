/* B2021648 — the first Food search must not wait on avoidable cold-start steps. */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import { warmSearchPath } from "../src/workspaces/food/lib/warmSearch.js";

const fakeDoc = () => {
  const links = [];
  return { links, head: { appendChild: (l) => links.push(l) }, createElement: () => ({}), querySelector: () => null };
};

describe("warmSearchPath", () => {
  it("preconnects, resolves the auth session BEFORE the warm search, then searches", async () => {
    const order = [];
    const supabase = { auth: { getSession: async () => { order.push("session"); } } };
    const search = vi.fn(async () => { order.push("search"); });
    const doc = fakeDoc();
    await warmSearchPath({ supabase, search, doc, origin: "https://x.supabase.co" });
    expect(doc.links[0]).toMatchObject({ rel: "preconnect", href: "https://x.supabase.co" });
    expect(order).toEqual(["session", "search"]);
  });
  it("never throws, whatever fails", async () => {
    const supabase = { auth: { getSession: async () => { throw new Error("x"); } } };
    await expect(warmSearchPath({ supabase, search: async () => { throw new Error("y"); }, doc: {}, origin: "o" })).resolves.toBeUndefined();
    await expect(warmSearchPath()).resolves.toBeUndefined();
  });
  it("FoodApp runs it once on mount (red on main: no warm-up existed)", () => {
    const app = fs.readFileSync("src/workspaces/food/FoodApp.jsx", "utf8");
    expect(app).toMatch(/warmSearchPath\(\{/);
    expect(app).not.toMatch(/from "\.\.\/site-planner/);
  });
});
