// source-scan: the "+n more" pill must stay a real <button> with a click handler; the component cannot be rendered in node.
// NEW-1 (2026-11-25): the "+n more" pill under the toast stack must open the hidden toasts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { visibleToasts, TOAST_CAP } from "../src/shared/ui/Toast.jsx";

const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: "t" + i, text: "Deleted Parcel " + i }));

describe("toast stack expand", () => {
  for (const n of [0, 1, 2, 3, 12]) {
    it(`${n} toast(s), collapsed: at most the cap shows, the rest are counted`, () => {
      const v = visibleToasts(mk(n), TOAST_CAP, false);
      expect(v.shown.length).toBe(Math.min(n, TOAST_CAP));
      expect(v.more).toBe(Math.max(0, n - TOAST_CAP));
      expect(v.canCollapse).toBe(false);
    });
    it(`${n} toast(s), expanded: every toast shows and nothing is hidden`, () => {
      const v = visibleToasts(mk(n), TOAST_CAP, true);
      expect(v.shown.length).toBe(n);
      expect(v.more).toBe(0);
      // "Show fewer" only means something while there is more than the cap
      expect(v.canCollapse).toBe(n > TOAST_CAP);
      expect(v.expanded).toBe(n > TOAST_CAP);
    });
  }
  it("expiry while expanded: dropping back to the cap collapses (no stray Show fewer)", () => {
    const v = visibleToasts(mk(TOAST_CAP), TOAST_CAP, true);
    expect(v.expanded).toBe(false);
    expect(v.canCollapse).toBe(false);
  });
  it("the pill is a real button with a click handler, not a dead div", () => {
    const src = readFileSync(new URL("../src/shared/ui/Toast.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/<button[^>]*data-testid="toast-more"[\s\S]{0,200}onClick=\{\(\) => setExpanded\(true\)\}/);
    expect(src).toMatch(/data-testid="toast-fewer"/);
  });
});
