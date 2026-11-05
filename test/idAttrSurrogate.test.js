/* B2194740 — the account stamped on a looked-up lot is never the layer's own row number.
 * The owner's SCHIEL lot carried acct "634440" (its OBJECTID) while the county's account is 0421030000123.
 * Harris resolves correctly in today's code (the stamp was written by an older build), but real rows from
 * Bernalillo NM (UPC) and Macomb MI (TAX_ID) still fell through to OBJECTID = "1". */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { idAttrFor } from "../src/workspaces/site-planner/lib/parcelQuery.js";

const J = JSON.parse(fs.readFileSync(new URL("./fixtures/silvestriParcels.json", import.meta.url)));
const H = JSON.parse(fs.readFileSync(new URL("./fixtures/countyRecordRows.json", import.meta.url)));

describe("idAttrFor never returns a row-number surrogate", () => {
  it("the owner's SCHIEL row (Harris) -> the HCAD account, not OBJECTID 634440", () => {
    expect(idAttrFor("harris", J.schielAttrs)).toBe("0421030000123");
  });
  it("Bernalillo NM and Macomb MI (real rows) -> their real account, not '1'", () => {
    expect(idAttrFor("nm_bernalillo", H.rows.nm_bernalillo.attrs)).toBe(String(H.rows.nm_bernalillo.attrs.UPC));
    expect(idAttrFor("mi_macomb", H.rows.mi_macomb.attrs)).toBe(String(H.rows.mi_macomb.attrs.TAX_ID));
  });
  it("a layer with ONLY a row number stores no account at all", () => {
    expect(idAttrFor("nowhere", { OBJECTID: 7, Shape_Area: 12 })).toBeNull();
  });
  for (const [k, r] of Object.entries(H.rows)) {
    it(`${k}: the stamped account is not any of the row's OBJECTID/FID values`, () => {
      const id = idAttrFor(k, r.attrs);
      const surrogates = Object.keys(r.attrs).filter((x) => /^(objectid|fid|oid|objectid_?\d+)$/i.test(x.replace(/^.*\./, ""))).map((x) => String(r.attrs[x]));
      if (id != null) {
        // a county whose real account column legitimately equals its row number would be a coincidence; none of the 131 do
        expect(surrogates.includes(String(id))).toBe(false);
      }
    });
  }
});
