/* NEW-1 — Settings → Profile: Save is enabled only while the form differs from the SAVED values.
 * Pure rule (no jsdom in this repo); the real-browser half is e2e/settings-drill-in.spec.js.
 * Fails on the pre-change tree, where Save was always enabled and no such module existed. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { savedProfileValues, profileDirty } from "../src/workspaces/site-planner/lib/settingsForm.js";

const src = readFileSync(new URL("../src/workspaces/site-planner/components/AuthPanel.jsx", import.meta.url), "utf8");
const user = { email: "a@b.co", user_metadata: { first_name: "Mike", last_name: "Abbott", org: "Demo Dev Co" } };

describe("profileDirty — Save enablement", () => {
  const saved = savedProfileValues({ first_name: "Mike", last_name: "Abbott", org: "Demo Dev Co" }, user);
  it("a form that matches the saved values is clean (Save disabled)", () => {
    expect(profileDirty(saved, { first: "Mike", last: "Abbott", org: "Demo Dev Co" })).toBe(false);
  });
  it("editing any one field makes it dirty", () => {
    expect(profileDirty(saved, { first: "Mike", last: "Abbott", org: "Other Co" })).toBe(true);
    expect(profileDirty(saved, { first: "Michael", last: "Abbott", org: "Demo Dev Co" })).toBe(true);
    expect(profileDirty(saved, { first: "Mike", last: "Abbot", org: "Demo Dev Co" })).toBe(true);
  });
  it("editing a field BACK to the saved value is clean again (a comparison, not a touched flag)", () => {
    let form = { first: "Mike", last: "Abbott", org: "Other Co" };
    expect(profileDirty(saved, form)).toBe(true);
    form = { ...form, org: "Demo Dev Co" };
    expect(profileDirty(saved, form)).toBe(false);
  });
  it("after a save the written values become the baseline (clean again)", () => {
    const form = { first: "Mike", last: "Abbott", org: "New Co" };
    expect(profileDirty(saved, form)).toBe(true);
    const nowSaved = { first: form.first.trim(), last: form.last.trim(), org: form.org.trim() };
    expect(profileDirty(nowSaved, form)).toBe(false);
  });
  it("whitespace-only differences are not edits (values are saved trimmed)", () => {
    expect(profileDirty(saved, { first: " Mike ", last: "Abbott", org: "Demo Dev Co  " })).toBe(false);
  });
  it("falls back to signup metadata when there is no profile row, like the form seed", () => {
    expect(savedProfileValues(null, user)).toEqual({ first: "Mike", last: "Abbott", org: "Demo Dev Co" });
    expect(savedProfileValues({ first_name: "Row" }, user).first).toBe("Row");
  });
});

describe("AuthPanel wiring (source guard)", () => {
  it("Save is disabled by the dirty comparison and reads Save / Save changes", () => {
    expect(src).toMatch(/disabled=\{busy \|\| !isDirty\}/);
    expect(src).toMatch(/isDirty \? "Save changes" : "Save"/);
    expect(src).not.toMatch(/Save profile/);
  });
  it("every Profile input has an associated <label>, none is placeholder-only", () => {
    for (const k of ["first", "last", "org"]) {
      expect(src).toMatch(new RegExp("<label htmlFor=\\{`\\$\\{uid\\}-" + k + "`\\}"));
      expect(src).toMatch(new RegExp("<input id=\\{`\\$\\{uid\\}-" + k + "`\\}"));
    }
  });
  it("every way out goes through the discard guard", () => {
    expect(src).toMatch(/Discard changes\?/);
    expect(src).toMatch(/Keep editing/);
    expect(src).toMatch(/onClose=\{requestClose\}/);
    expect(src).not.toMatch(/<Wrap onClose=\{onClose\} msg=\{msg\} width=\{560\}/);
  });
  it("Sign out is destructive text, not a filled button", () => {
    expect(src).toMatch(/var\(--danger-text\)/);
    expect(src).toMatch(/data-settings-signout/);
  });
});
