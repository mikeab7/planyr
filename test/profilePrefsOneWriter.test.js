import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// A fake `profiles` table with real async gaps between the read and the write, so two UN-serialized
// read-modify-writes interleave exactly like two browser tabs / two modules saving in the same moment.
const db = { row: { id: "u1", prefs: {} } };
const tick = () => new Promise((r) => setTimeout(r, 5));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => { await tick(); return { data: JSON.parse(JSON.stringify(db.row)), error: null }; } }) }),
      upsert: async (r) => { await tick(); db.row = JSON.parse(JSON.stringify(r)); return { error: null }; },
    }),
  },
}));

import { saveDashboardLayout } from "../src/workspaces/dashboard/lib/dashboardPrefs.js";
import { saveProjectOrder } from "../src/workspaces/dashboard/lib/dashboardProjectOrderPrefs.js";
import { saveSinceLastHere } from "../src/workspaces/dashboard/lib/dashboardSinceLastHerePrefs.js";
import { saveCompsRatePeriod } from "../src/shared/comps/lib/compsRatePeriodPrefs.js";
import { updatePrefs, setSitesPanelPref } from "../src/workspaces/site-planner/lib/userPrefsStore.js";

beforeEach(() => { db.row = { id: "u1", prefs: {} }; });

describe("every profiles.prefs writer shares ONE serialized queue (no lost update)", () => {
  it("five writers in different modules saving at once all land", async () => {
    await Promise.all([
      saveProjectOrder("u1", { ids: ["a", "b"], at: 1 }),
      saveCompsRatePeriod("u1", "monthly"),
      saveSinceLastHere("u1", { lastVisitAt: 5, snapshot: {} }),
      saveDashboardLayout("u1", [], [], 3),
      updatePrefs("u1", (p) => setSitesPanelPref(p, { pinned: ["x"] })),
    ]);
    const k = Object.keys(db.row.prefs);
    expect(k).toEqual(expect.arrayContaining(["dashboardProjectOrder", "compsRatePeriod", "sinceLastHere", "dashboardLayout", "sitesPanel"]));
    expect(db.row.prefs.sitesPanel.pinned).toEqual(["x"]);
    expect(db.row.prefs.compsRatePeriod).toBe("monthly");
  });
});

describe("guard: nothing outside the one writer writes profiles.prefs", () => {
  const ALLOWED = new Set(["src/shared/profile/profilePrefsWriter.js", "src/workspaces/site-planner/lib/userPrefsStore.js"]);
  function walk(d, out = []) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p, out); else if (/\.(js|jsx)$/.test(f.name)) out.push(p);
    }
    return out;
  }
  it("no other src file upserts/updates the profiles table with prefs", () => {
    const bad = [];
    for (const f of walk("src")) {
      const rel = f.split(path.sep).join("/");
      if (ALLOWED.has(rel)) continue;
      const s = fs.readFileSync(f, "utf8");
      // an upsert/update on `profiles` whose payload mentions `prefs` (profile.js writes name columns only — allowed)
      if (/from\(\s*["']profiles["']\s*\)\s*\.\s*(upsert|update)\s*\([^)]*\bprefs\b/.test(s.replace(/\s+/g, " "))) bad.push(rel);
    }
    expect(bad).toEqual([]);
  });
});
