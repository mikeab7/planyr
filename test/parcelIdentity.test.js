/* NEW-1 — a Chambers lot's identity key must not collide with its neighbour's (shared corners).
 * Fixtures are the two real Grand Port lots (site smqfy2r7pdec), attribute names verbatim. */
import { describe, it, expect } from "vitest";
import { parcelKey, parcelIdOf, ringsHash, storedParcelKey } from "../src/workspaces/site-planner/lib/parcelIdentity.js";

const P = "ChambersCADWeb.DBO.";
const lot20887 = { [`${P}Accounts.OBJECTID`]: 2936719, [`${P}TaxParcels.OBJECTID`]: 3642194, [`${P}TaxParcels.Parcel_CAMA`]: 20887 };
const lot15328 = { [`${P}Accounts.OBJECTID`]: 2933439, [`${P}TaxParcels.OBJECTID`]: 3642195, [`${P}TaxParcels.Parcel_CAMA`]: 15328 };
const v0 = [-94.872878, 29.810689]; // the shared first vertex measured in the live DB
const ring20887 = [v0, [-94.8715, 29.8107], [-94.8715, 29.8090], [-94.87288, 29.8090], v0];
const ring15328 = [v0, [-94.87288, 29.8090], [-94.8745, 29.8090], [-94.8745, 29.8107], v0];

// The pre-fix rule, replayed verbatim: proves the fixture actually collides on main.
const oldKey = (attrs, rings) => { const oid = attrs?.OBJECTID ?? attrs?.objectid ?? attrs?.OID; if (oid != null) return `oid:${oid}`; const p = rings?.[0]?.[0]; return `geo:${p[0].toFixed(6)},${p[1].toFixed(6)}`; };

describe("parcelIdentity", () => {
  it("the pre-fix rule collides on these exact lots (fixture has teeth)", () => {
    expect(oldKey(lot20887, [ring20887])).toBe(oldKey(lot15328, [ring15328]));
  });
  it("RED-PROOF: neighbours sharing a first vertex get different keys (prefixed ids)", () => {
    const a = parcelKey(lot20887, [ring20887]), b = parcelKey(lot15328, [ring15328]);
    expect(a).toBe("oid:3642194"); expect(b).toBe("oid:3642195"); expect(a).not.toBe(b);
  });
  it("prefers the geometry table's id over the joined accounts table", () => {
    expect(parcelIdOf(lot20887)).toBe(3642194);
  });
  it("two accounts on one shape → same key", () => {
    const second = { ...lot20887, [`${P}Accounts.OBJECTID`]: 9999999 };
    expect(parcelKey(second, [ring20887])).toBe(parcelKey(lot20887, [ring20887]));
  });
  it("bare OBJECTID (Harris) is unchanged", () => {
    expect(parcelKey({ OBJECTID: 77 }, [ring20887])).toBe("oid:77");
    expect(parcelKey({ objectid: 5 }, [ring20887])).toBe("oid:5");
    expect(parcelKey({ OBJECTID: 77 }, [ring20887], { namespace: "harris" })).toBe("harris:oid:77");
  });
  it("no id → whole-ring hash: neighbours differ, same shape (rotated/reversed/unclosed) matches", () => {
    const a = parcelKey({}, [ring20887]), b = parcelKey({}, [ring15328]);
    expect(a).not.toBe(b);
    const rot = [ring20887[2], ring20887[3], ring20887[0], ring20887[1]];
    expect(parcelKey({}, [rot])).toBe(a);
    expect(parcelKey({}, [[...ring20887].reverse()])).toBe(a);
  });
  it("multipart: key covers every part, order-independent", () => {
    expect(ringsHash([ring20887, ring15328])).toBe(ringsHash([ring15328, ring20887]));
    expect(ringsHash([ring20887, ring15328])).not.toBe(ringsHash([ring20887]));
  });
  it("a stored geo:-keyed parcel is recognised as already-in-plan", () => {
    const stored = { id: "e1454937fcckcr", attrs: lot20887, gisKey: "geo:-94.872878,29.810689" };
    expect(storedParcelKey(stored)).toBe(parcelKey(lot20887, [ring20887]));
    // and the sharing neighbour is NOT matched by it
    expect(storedParcelKey(stored)).not.toBe(parcelKey(lot15328, [ring15328]));
  });
  it("stored parcel without an id keeps its stored key", () => {
    expect(storedParcelKey({ attrs: {}, gisKey: "geo:abc" })).toBe("geo:abc");
  });
});
