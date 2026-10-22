import { describe, it, expect, beforeEach } from "vitest";
import { serializeClip, parseClip, writeSystemClip, systemWriteFailed, resetBridge, CLIP_MARK } from "../src/workspaces/site-planner/lib/clipBridge.js";
import { collectClipboard, pasteClipboard } from "../src/workspaces/site-planner/lib/planClipboard.js";
import fs from "node:fs";

const KINDS = {
  el: { id: "b1", type: "building", cx: 10, cy: 20, w: 100, h: 50, rot: 12, dockSide: "x", name: "B1" },
  markup: { id: "m1", kind: "cloud", pts: [{ x: 0, y: 0 }, { x: 5, y: 5 }], stroke: "#f00", weight: 3 },
  measure: { id: "s1", kind: "area", pts: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }] },
  callout: { id: "c1", text: "hi", box: { x: 1, y: 2 }, tip: { x: 5, y: 6 } },
  parcel: { id: "p1", points: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }], active: true },
};
const state = { els: [KINDS.el], markups: [KINDS.markup], measures: [KINDS.measure], callouts: [KINDS.callout], parcels: [KINDS.parcel] };
const tr = { el: (e, dx, dy) => ({ ...e, cx: e.cx + dx, cy: e.cy + dy }), markup: (m) => ({ ...m }), measure: (m) => ({ ...m }) };

describe("clipBridge", () => {
  beforeEach(resetBridge);
  for (const kind of Object.keys(KINDS)) {
    it(`${kind}: copy → system text → parse → paste yields a new id with identical properties`, () => {
      const copied = { ...collectClipboard([{ kind, id: KINDS[kind].id }], state), siteId: "s", origin: null };
      const parsed = parseClip(serializeClip(copied));
      expect(parsed).toEqual(JSON.parse(JSON.stringify(copied)));
      const made = pasteClipboard(parsed.items, { mint: () => "NEW", translate: tr, dx: 0, dy: 0 });
      const out = made[{ el: "els", markup: "markups", measure: "measures", callout: "callouts", parcel: "parcels" }[kind]][0];
      expect(out.id).toBe("NEW");
      const { id: _a, active: _b, ...rest } = out; const { id: _c, active: _d, ...src } = KINDS[kind];
      expect(rest).toEqual(src);
    });
  }
  it("rejects foreign / malformed text", () => {
    for (const t of ["hello", "", null, "{", JSON.stringify({ mark: "x" }), `{"mark":"${CLIP_MARK}","v":99}`, JSON.stringify({ mark: CLIP_MARK, v: 1, payload: { items: [] } })]) expect(parseClip(t)).toBeNull();
  });
  it("write failure is reported, flagged, and never throws", async () => {
    let why = null;
    const ok = await writeSystemClip({ items: [{ kind: "el", obj: KINDS.el }] }, { clipboard: { writeText: () => Promise.reject(new Error("denied")) } }, (w) => { why = w; });
    expect(ok).toBe(false); expect(why).toBe("denied"); expect(systemWriteFailed()).toBe(true);
    const ok2 = await writeSystemClip({ items: [{ kind: "el", obj: KINDS.el }] }, { clipboard: { writeText: async () => {} } });
    expect(ok2).toBe(true); expect(systemWriteFailed()).toBe(false);
    expect(await writeSystemClip({ items: [{ kind: "el", obj: KINDS.el }] }, null, () => {})).toBe(false);
  });
  it("planner wiring: copy publishes, paste event parses the payload before images", () => {
    const s = fs.readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");
    expect(s).toMatch(/publishClip\(setCanvasClip/);
    expect(s.indexOf("parseClip(")).toBeGreaterThan(0);
    expect(s.indexOf("parseClip(")).toBeLessThan(s.indexOf("imageFileFromClipboard(cd)"));
  });
});
