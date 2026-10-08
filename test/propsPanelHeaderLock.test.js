// NEW-1 / NEW-2 / NEW-3 / NEW-4 / NEW-5 (owner 2026-10-08) — the Properties panel cleanup.
//   NEW-1  ONE header row, just the thing's own type name (propsPanelTitle) — no "Element · X",
//          "Markup · X", "Selected · X" second row anywhere.
//   NEW-2  ONE greyscale lock (shared/ui/LockToggle.jsx) — no 🔒/🔓 emoji (yellow) in any module.
//   NEW-3..5  Cloud panel only: 5 ft arc steps / no S-M-L, metadata + dates behind a collapsed
//          "More", no how-to hint text.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { propsPanelTitle, kindTitle, measureTitle } from "../src/workspaces/site-planner/lib/propsPanelTitle.js";
import { CLOUD_ARC_STEP_FT, clampCloudArcFt, CLOUD_ARC_MAX_FT } from "../src/workspaces/site-planner/lib/cloudGeometry.js";

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const SP = read("src/workspaces/site-planner/SitePlanner.jsx");

describe("NEW-1 — one title, the thing's own type name", () => {
  it("names each family in title case with no category prefix", () => {
    expect(propsPanelTitle({ markup: { kind: "cloud" } })).toBe("Cloud");
    expect(propsPanelTitle({ markup: { kind: "rect" } })).toBe("Rect");
    expect(propsPanelTitle({ markup: { kind: "easement" } })).toBe("Easement");
    expect(propsPanelTitle({ measureMode: "line" })).toBe("Distance");
    expect(propsPanelTitle({ measureMode: "area" })).toBe("Area");
    expect(propsPanelTitle({ callout: { noLeader: true } })).toBe("Text box");
    expect(propsPanelTitle({ callout: { noLeader: false } })).toBe("Callout");
    expect(propsPanelTitle({ elementLabel: "Building" })).toBe("Building");
    expect(propsPanelTitle({ multiCount: 3 })).toBe("3 selected");
  });
  it("never carries a breadcrumb separator or category word", () => {
    for (const t of [kindTitle("cloud"), measureTitle("polyline"), propsPanelTitle({ elementLabel: "Detention pond" })]) {
      expect(t).not.toMatch(/·|Element|Markup|Selected/);
    }
  });
  it("the planner reads the header from the one helper and no inner section re-titles the panel", () => {
    expect(SP).toContain("propsPanelTitle({");
    expect(SP).not.toMatch(/Markup · Cloud|`Markup · |`Measurement · |`Selected · |`Easement · /);
    expect(SP).not.toMatch(/Element\{\(\(\) =>/);
    // the per-kind inner Sections render title-less
    for (const re of [/<Section title=\{null\}>\s*\{\/\* NEW-1 \(B1618656\)/, /<Section title=\{null\}>\s*<StdSubLabel>Text<\/StdSubLabel>/]) {
      expect(SP).toMatch(re);
    }
  });
});

describe("NEW-2 — one greyscale lock", () => {
  const shared = read("src/shared/ui/LockToggle.jsx");
  it("the shared glyph is token-grey only and distinguishes state by shape, not opacity", () => {
    expect(shared).toContain("var(--lock-locked)");
    expect(shared).toContain("var(--lock-open)");
    expect(shared).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(shared).not.toMatch(/opacity\s*[=:]/i);
    expect(shared).toMatch(/fill=\{locked \? c : "none"\}/); // solid when locked, outline when open
  });
  it("no source file renders a lock emoji (they paint yellow)", () => {
    const hits = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
        const rel = path.join(d, e.name);
        if (e.isDirectory()) walk(rel);
        else if (/\.(jsx?|mjs)$/.test(e.name)) {
          const lines = read(rel).split("\n");
          lines.forEach((l, i) => { if (/[🔒🔓]/u.test(l) && !/^\s*(\/\/|\*|\{\/\*|\/\*)/.test(l)) hits.push(`${rel}:${i + 1}`); });
        }
      }
    };
    walk("src");
    expect(hits).toEqual([]);
  });
  it("the building header lock no longer fills with the accent colour when locked", () => {
    expect(SP).not.toMatch(/b\.locked \? \{ \.\.\.hdrBtn, background: "var\(--accent\)"/);
  });
});

describe("NEW-3..5 — Cloud panel only", () => {
  it("arc size steps by 5 ft; a typed value is still accepted; presets are gone from the panel", () => {
    expect(CLOUD_ARC_STEP_FT).toBe(5);
    expect(SP).toContain("step={CLOUD_ARC_STEP_FT}");
    expect(SP).not.toMatch(/Object\.entries\(CLOUD_ARC_PRESETS\)/);
    expect(clampCloudArcFt(7.25)).toBe(7.25);
    expect(clampCloudArcFt(99)).toBe(CLOUD_ARC_MAX_FT);
  });
  it("Subject…Author and Created/Modified live inside one collapsed 'More'", () => {
    const i = SP.indexOf('sectionId="cloud-more"');
    expect(i).toBeGreaterThan(0);
    expect(SP.slice(i - 60, i + 80)).toContain('title="More" defaultOpen={false}');
    const end = SP.indexOf("</Collapse>", i);
    const block = SP.slice(i, end);
    for (const f of ['label="Subject"', 'label="Comment"', 'label="Status"', 'label="Label"', 'label="Layer"', 'label="Author"', "Created {fmtWhen", "Modified {fmtWhen"]) {
      expect(block, f).toContain(f);
    }
    // Arc size stays OUTSIDE it
    expect(SP.indexOf('<Field label="Arc size">')).toBeLessThan(i);
  });
  it("the Cloud panel has no how-to hint; other markups keep theirs", () => {
    expect(SP).toMatch(/\{!isCloud && \(\s*<div style=\{\{ fontSize: 11, color: PAL\.muted, lineHeight: 1\.5, marginTop: 8 \}\}>/);
  });
});
