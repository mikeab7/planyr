/* NEW-1 — A TEAMMATE OPENING A SHARED PLAN MAY NEVER ERASE THE OWNER'S OVERLAY POINTER.
 *
 * Storage answers an RLS-denied object with the same 400 "Object not found" as a missing one. The
 * rehydrate loop healed that answer to `{ storageKey: null, storageMissing: true }` on the record —
 * which lives in the SHARED plan row a teammate may write. Production, read-only, 2026-10-11: 12 records
 * on shared plans healed that way while their objects were still in the bucket.
 *
 * Red on main: `lib/overlayHeal.js` did not exist and the heal branch was gated only on
 * `reason === "missing" && o.storageKey && isCloudActive()`. The pre-fix rule is replayed below as the
 * mutation check, so a green run cannot be a no-op. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { mayHealMissingOverlay, overlayLoadReason, overlayKeyOwner } from "../src/workspaces/site-planner/lib/overlayHeal.js";

const OWNER = "b0000000-0000-4000-8000-000000000001";
const MATE = "b0000000-0000-4000-8000-000000000002";
const ownerKey = `${OWNER}/site-overlays/smplan1/e1abc.pdf`;

// The rule main shipped, verbatim in shape (reason from res.missing, heal gated on cloud only).
const preFixHeals = ({ key, missing, cloudActive }) => (key ? (missing ? "missing" : "network") : "missing") === "missing" && !!key && cloudActive;

describe("heal guard — the reader's OWN folder only", () => {
  it("the owner's own confirmed-missing object heals (the B785 behaviour is kept)", () => {
    expect(mayHealMissingOverlay({ key: ownerKey, missing: true, uid: OWNER, cloudActive: true })).toBe(true);
    expect(overlayLoadReason({ key: ownerKey, missing: true, uid: OWNER })).toBe("missing");
  });

  it("a TEAMMATE reading the owner's object never heals — it is 'denied', not 'missing'", () => {
    const a = { key: ownerKey, missing: true, uid: MATE, cloudActive: true };
    expect(preFixHeals(a)).toBe(true);                 // mutation check: main erased the pointer here
    expect(mayHealMissingOverlay(a)).toBe(false);
    expect(overlayLoadReason(a)).toBe("denied");
  });

  it("no uid / signed out / transient → never heals", () => {
    expect(mayHealMissingOverlay({ key: ownerKey, missing: true, uid: null, cloudActive: true })).toBe(false);
    expect(mayHealMissingOverlay({ key: ownerKey, missing: true, uid: OWNER, cloudActive: false })).toBe(false);
    expect(mayHealMissingOverlay({ key: ownerKey, missing: false, uid: OWNER, cloudActive: true })).toBe(false);
    expect(overlayLoadReason({ key: ownerKey, missing: false, uid: OWNER })).toBe("network");
    expect(overlayLoadReason({ key: ownerKey, missing: true, uid: null })).toBe("denied");
  });

  it("path tricks cannot make a foreign key look like the reader's own", () => {
    for (const k of [`/${MATE}/x.pdf`, `${MATE}//x.pdf`, `${MATE}/../${OWNER}/x.pdf`, `./${MATE}/x.pdf`, `${MATE}\\x.pdf`, MATE, ""]) {
      expect(mayHealMissingOverlay({ key: k, missing: true, uid: MATE, cloudActive: true })).toBe(false);
    }
    expect(overlayKeyOwner(`${MATE}/site-overlays/p/e.png`)).toBe(MATE);
    expect(overlayKeyOwner(`${MATE}/../x`)).toBe(null);
  });

  it("an idb-only record (no cloud key) is still 'missing' and still has nothing to heal", () => {
    expect(overlayLoadReason({ key: "", missing: false, uid: OWNER })).toBe("missing");
    expect(mayHealMissingOverlay({ key: "", missing: true, uid: OWNER, cloudActive: true })).toBe(false);
  });
});

describe("the planner uses the guard — the old ungated heal cannot come back", () => {
  const src = fs.readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  it("the only storageMissing heal is gated on mayHealMissingOverlay", () => {
    const heals = src.match(/storageKey:\s*null,\s*storageMissing:\s*true/g) || [];
    expect(heals.length).toBe(1);
    const at = src.indexOf("storageKey: null, storageMissing: true");
    expect(src.slice(at - 400, at)).toMatch(/mayHealMissingOverlay\(\{[^}]*activeUid\(\)/);
    expect(src).not.toMatch(/reason === "missing" && o\.storageKey && isCloudActive\(\)\)/);
  });
  it("the load reason comes from overlayLoadReason, and 'denied' retries rather than asking for a re-add", () => {
    expect(src).toMatch(/const reason = overlayLoadReason\(/);
    expect(src).toMatch(/ovErr === "network" \|\| ovErr === "denied"\) retryOverlay/);
  });
});
