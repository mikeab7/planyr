/* NEW-1 (2026-10-22) — a county with no parcel data says WHY and carries an "Email Michael to request it" link
 * (owner request 2026-10-21). Red-proof: on main the sentence was the bare "<County> — no parcel data wired here yet." for every
 * county alike and no link existed — every assertion on `reason`, `href` and the call-site wiring below fails there. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  GAP_REASONS, PARCEL_GAPS, PARCEL_REQUEST_EMAIL, PARCEL_REQUEST_LABEL, gapKey, gapReasonFor, gapSentence, parcelGapNotice, parcelRequestHref,
} from "../src/workspaces/site-planner/lib/parcelGaps.js";
import { COUNTIES_MAP, noParcelSourceNote } from "../src/workspaces/site-planner/lib/counties.js";

const gapId = (name, state, extra = {}) => ({ status: "no-source", key: null, name, state, nearEdge: false, ...extra });
const src = (p) => readFileSync(new URL(`../src/workspaces/site-planner/${p}`, import.meta.url), "utf8");

describe("the reason lookup — one sample of each code, across more than three states", () => {
  it.each([
    // paywall — qPublic "Access Restricted" (owner's Chrome, 2026-10-21), Equator paid downloads, lapsed GA subscriptions
    ["Pike County", "KY", "paywall"], ["Bath County", "KY", "paywall"], ["Lawrence County", "KY", "paywall"],
    ["Upson County", "GA", "paywall"], ["Oglethorpe County", "GA", "paywall"], ["Sioux County", "IA", "paywall"], ["Jo Daviess County", "IL", "paywall"],
    // locked — a layer exists, the publisher has not opened it
    ["Breckinridge County", "KY", "locked"], ["Hart County", "KY", "locked"], ["Butler County", "MO", "locked"], ["Caldwell County", "MO", "locked"],
    ["Baraga County", "MI", "locked"], ["Calhoun County", "MI", "locked"], ["Johnson County", "KS", "locked"], ["Knox County", "TN", "locked"],
    ["Pointe Coupee Parish", "LA", "locked"], ["Twin Falls County", "ID", "locked"], ["Ferry County", "WA", "locked"], ["Carroll County", "IL", "locked"],
    // unreachable — a real server Planyr could not reach
    ["Boyle County", "KY", "unreachable"], ["Clark County", "KY", "unreachable"], ["Edgar County", "IL", "unreachable"], ["Polk County", "OR", "unreachable"],
    ["Dubuque County", "IA", "unreachable"],
    // none — owner-accepted gaps and the default
    ["Fulton County", "KY", "none"], ["New Madrid County", "MO", "none"], ["Pemiscot County", "MO", "none"], ["Adams County", "IA", "none"],
    ["Washtenaw County", "MI", "none"], ["Bryan County", "OK", "none"], ["Bacon County", "GA", "none"],
  ])("%s, %s → %s", (name, st, reason) => { expect(gapReasonFor(name, st)).toBe(reason); });

  it("a county nobody has researched is `none` — Texas, Colorado, and a state with no table at all", () => {
    expect(gapReasonFor("Walker County", "TX")).toBe("none");
    expect(gapReasonFor("Mesa County", "CO")).toBe("none");
    expect(gapReasonFor("Anywhere County", "ZZ")).toBe("none");
  });

  it("Kentucky: where a county fits both, the map being behind a login wins (Bath/Edmonson/Johnson/Knott are paywall, not locked)", () => {
    for (const c of ["Bath", "Edmonson", "Johnson", "Knott"]) expect(gapReasonFor(`${c} County`, "KY")).toBe("paywall");
  });

  it("the key uses the same slug the wired-county keys use (designation words and punctuation fall away)", () => {
    expect(gapKey("Pike County", "ky")).toBe("ky_pike");
    expect(gapKey("Ste. Genevieve County", "MO")).toBe("mo_stegenevieve");
    expect(gapKey("St. Helena Parish", "LA")).toBe("la_sthelena");
    expect(gapKey("O'Brien County", "IA")).toBe("ia_obrien");
    expect(gapKey("Walker", "TX")).toBe("walker"); // Texas stays bare, like its wired keys
    expect(gapKey("", "KY")).toBeNull();
  });

  it("every entry is well formed and none names a county that is wired (wiring a county means deleting its gap row)", () => {
    for (const [k, v] of Object.entries(PARCEL_GAPS)) {
      expect(k, k).toMatch(/^[a-z]{2}_[a-z]+$/);
      expect(GAP_REASONS, k).toContain(v[0]);
      expect(COUNTIES_MAP[k], `${k} is wired but still has a gap row`).toBeUndefined();
    }
  });
});

describe("the sentence — plain words, one line, names the county", () => {
  const JARGON = /\b(token|rest|cors|relay|qpublic|schneider|equator|arcgis|api|geocortex|integrity|fetchgis|colligo|beacon)\b/i;
  it.each(GAP_REASONS)("%s reads as a short plain sentence with no vendor / protocol jargon", (reason) => {
    const s = gapSentence(reason, "Pike County");
    expect(s).toContain("Pike County");
    expect(s).not.toMatch(JARGON);
    expect(s.length).toBeLessThan(110);
    expect(s).toMatch(/\.$/);
    expect(s).not.toMatch(/wired/i);
  });
  it("says the four different things", () => {
    expect(gapSentence("paywall", "Pike County")).toBe("Pike County keeps its parcel map behind a paid subscription, so Planyr can't show lots here yet.");
    expect(gapSentence("locked", "Bath County")).toContain("isn't open to the public");
    expect(gapSentence("unreachable", "Boyle County")).toBe("Boyle County's parcel map server isn't reachable from Planyr right now.");
    expect(gapSentence("none", "Fulton County")).toBe("Planyr hasn't found a public parcel map it can use for Fulton County.");
  });
});

describe("the notice for a countyIdentity answer", () => {
  it("a no-source county gets its reason, a county name, and a request link", () => {
    const n = parcelGapNotice(gapId("Pike County", "KY"), { lat: 37.4791, lng: -82.5188 });
    expect(n.reason).toBe("paywall");
    expect(n.message).toBe(gapSentence("paywall", "Pike County"));
    expect(n.href.startsWith(`mailto:${PARCEL_REQUEST_EMAIL}?`)).toBe(true);
    expect(PARCEL_REQUEST_LABEL).toBe("Email Michael to request it");
  });
  it("noParcelSourceNote is the same sentence (one source), and TX / CO bare names read as 'County'", () => {
    expect(noParcelSourceNote(gapId("Pike County", "KY"))).toBe(parcelGapNotice(gapId("Pike County", "KY")).message);
    expect(parcelGapNotice(gapId("Walker", "TX")).county).toBe("Walker County");
    expect(parcelGapNotice(gapId("Mesa", "CO")).county).toBe("Mesa County");
    expect(parcelGapNotice(gapId("Orleans Parish", "LA")).county).toBe("Orleans Parish"); // never "Orleans Parish County"
  });
  it("a WIRED county whose click missed (water, right-of-way) gets NO notice and NO link — today's behaviour is untouched", () => {
    expect(parcelGapNotice({ status: "ok", key: "ky_fayette", name: "Fayette County", state: "KY" }, { lat: 38, lng: -84.5 })).toBeNull();
    expect(noParcelSourceNote({ status: "ok", key: "ky_fayette", name: "Fayette County", state: "KY" })).toBeNull();
  });
  it("a county a statewide layer covers is never a gap (a failing statewide layer keeps its outage / cached-copy messaging)", () => {
    expect(parcelGapNotice(gapId("Clark County", "NV", { statewideKey: "nv_statewide" }))).toBeNull();
  });
  it("no county resolved / outside coverage / geometry still loading → nothing, as before", () => {
    for (const status of ["pending", "outside"]) expect(parcelGapNotice({ status })).toBeNull();
    expect(parcelGapNotice(null)).toBeNull();
  });
});

describe("the mailto", () => {
  const parts = (href) => { const u = new URL(href); return { to: u.pathname, subject: u.searchParams.get("subject"), body: u.searchParams.get("body") }; };

  it("addresses Michael, subject names county and state, body names county, state, the reason shown and the clicked point, with an empty line for a note", () => {
    const n = parcelGapNotice(gapId("Pike County", "KY"), { lat: 37.47912, lng: -82.51876 });
    const { to, subject, body } = parts(n.href);
    expect(to).toBe("michael@planyr.io");
    expect(subject).toBe("Parcel data request: Pike County, KY");
    expect(body).toContain("County: Pike County, KY");
    expect(body).toContain(`Reason shown: ${n.message}`);
    expect(body).toContain("Point I clicked: 37.47912, -82.51876");
    expect(body.endsWith("\r\n\r\n")).toBe(true);
  });
  it("is URL-encoded: spaces, apostrophes, periods and commas in county names survive a round trip", () => {
    for (const [name, st] of [["Ste. Genevieve County", "MO"], ["St. Helena Parish", "LA"], ["O'Brien County", "IA"], ["Prince George's County", "MD"], ["Palo Alto County", "IA"]]) {
      const n = parcelGapNotice(gapId(name, st), { lat: 1, lng: 2 });
      expect(n.href, name).not.toMatch(/[ '"\n]/); // no raw space, apostrophe-in-attribute breaker, quote or newline
      expect(parts(n.href).subject, name).toBe(`Parcel data request: ${name}, ${st}`);
      expect(parts(n.href).body, name).toContain(`County: ${name}, ${st}`);
    }
  });
  it("leaves the point line out when there is no clicked point, and never prints NaN", () => {
    const body = parts(parcelGapNotice(gapId("Pike County", "KY")).href).body;
    expect(body).not.toContain("Point I clicked");
    expect(parts(parcelRequestHref({ name: "Pike County", state: "KY", sentence: "x.", lat: NaN, lng: 1 })).body).not.toContain("NaN");
  });
});

describe("the wiring — every place that said the bare sentence now carries the reason and the link", () => {
  const mf = src("MapFinder.jsx"), sp = src("SitePlanner.jsx"), card = src("components/ParcelInfoCard.jsx");
  it("no UI string still says 'no parcel data wired here yet'", () => {
    for (const [n, text] of [["MapFinder", mf], ["SitePlanner", sp], ["ParcelInfoCard", card], ["counties.js", src("lib/counties.js")]]) {
      const live = text.split("\n").filter((l) => /wired here yet/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l));
      expect(live, `${n} still prints the bare sentence`).toEqual([]);
    }
  });
  it("the map toast, the Pick-county-lots panel and the address-search card render the link, each beside its own message", () => {
    expect(mf).toMatch(/gapRequest\.message === err/);
    expect(mf).toMatch(/<ParcelRequestLink href=\{gapRequest\.href\}/);
    expect(sp).toMatch(/identifyRes\.request && <ParcelRequestLink/);
    expect(card).toMatch(/<ParcelRequestLink href=\{info\.request\}/);
    expect((mf.match(/request: gap\.href/g) || []).length).toBe(2); // both address-search exits
    expect((sp.match(/request: gap\.href/g) || []).length).toBe(2); // both Pick-county-lots exits
  });
  it("every call site passes the clicked point so the email carries it", () => {
    expect((mf.match(/parcelGapNotice\(countyIdentity\(latlng\.lat, latlng\.lng\), latlng\)/g) || []).length).toBe(4);
    expect((sp.match(/parcelGapNotice\(countyIdentity\(lat, lng\), \{ lat, lng \}\)/g) || []).length).toBe(2);
  });
});
