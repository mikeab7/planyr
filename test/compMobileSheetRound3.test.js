import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CompEntryMobileSheet from "../src/shared/comps/components/CompEntryMobileSheet.jsx";
import {
  guessPeriod, periodGuessStep, flipPeriod, flipBasis, flipTermUnit, termToMonths, termForDisplay,
  withTitleFallback, partyNameFallback, footerReadback, compDateLabel, moreDetailFields, mobilePartyLabels, mobileCol,
} from "../src/shared/comps/lib/compMobileSheetModel.js";
import { emptyDraft } from "../src/shared/comps/lib/comps.js";
import { TYPE_OPTIONS, applyCellEdit } from "../src/shared/comps/lib/compSheetColumns.js";

const draft = (compType, o = {}) => ({ ...emptyDraft(null), compType, ...o });
const row = (compType, o = {}, cellFlags = {}) => ({ _id: "r", draft: draft(compType, o), cellFlags });

describe("NEW-4 — period guess thresholds", () => {
  it("0.62 → monthly, 6.25 → yearly, 2.5 → none (and the edges 2 and 3 stay unpicked)", () => {
    expect(guessPeriod("0.62")).toBe("monthly");
    expect(guessPeriod("6.25")).toBe("annual");
    expect(guessPeriod("2.5")).toBe(null);
    expect(guessPeriod("2")).toBe(null);
    expect(guessPeriod("3")).toBe(null);
    expect(guessPeriod("1.99")).toBe("monthly");
    expect(guessPeriod("3.01")).toBe("annual");
  });
  it("no rate, zero or junk guesses nothing", () => {
    for (const r of ["", null, undefined, "0", "abc", "-1"]) expect(guessPeriod(r)).toBe(null);
  });
});

describe("NEW-4 — guess lifecycle (periodGuessStep)", () => {
  it("a rate with no period pre-picks a guess", () => {
    expect(periodGuessStep({ rate: "0.62", period: "", guessed: false, locked: false })).toEqual({ period: "monthly", guessed: true });
    expect(periodGuessStep({ rate: "6.25", period: "", guessed: false, locked: false })).toEqual({ period: "annual", guessed: true });
  });
  it("2 to 3 stays unpicked (the warn state)", () => {
    expect(periodGuessStep({ rate: "2.5", period: "", guessed: false, locked: false })).toBe(null);
  });
  it("an already-guessed period is left alone; editing the rate re-guesses", () => {
    expect(periodGuessStep({ rate: "0.62", period: "monthly", guessed: true, locked: false })).toBe(null);
    expect(periodGuessStep({ rate: "6.25", period: "monthly", guessed: true, locked: false })).toEqual({ period: "annual", guessed: true });
  });
  it("a guess that lands in 2–3 goes back to unpicked", () => {
    expect(periodGuessStep({ rate: "2.5", period: "monthly", guessed: true, locked: false })).toEqual({ period: "", guessed: false });
  });
  it("clearing the rate while the period is still a guess clears the guess", () => {
    expect(periodGuessStep({ rate: "", period: "monthly", guessed: true, locked: false })).toEqual({ period: "", guessed: false });
  });
  it("clearing the rate never touches a period the person picked", () => {
    expect(periodGuessStep({ rate: "", period: "annual", guessed: false, locked: false })).toBe(null);
  });
  it("a tap locks it: no re-guess on later rate edits, even in the guessed range", () => {
    expect(periodGuessStep({ rate: "0.62", period: "annual", guessed: false, locked: true })).toBe(null);
    expect(periodGuessStep({ rate: "", period: "", guessed: false, locked: true })).toBe(null);
  });
  it("a period the paste set is never overwritten", () => {
    expect(periodGuessStep({ rate: "0.62", period: "annual", guessed: false, locked: false })).toBe(null);
  });
  it("flips", () => {
    expect(flipPeriod("monthly")).toBe("annual");
    expect(flipPeriod("annual")).toBe("monthly");
    expect(flipPeriod("")).toBe("monthly");
    expect(flipBasis("nnn")).toBe("gross");
    expect(flipBasis("gross")).toBe("nnn");
    expect(flipTermUnit("months")).toBe("years");
    expect(flipTermUnit("years")).toBe("months");
  });
});

describe("NEW-5 — Term pill: yr entry commits months", () => {
  it("5 yr → 60 months through the real column setter; mo stays as typed", () => {
    const col = mobileCol("leaseTerm");
    expect(col.getValue(applyCellEdit(col, draft("lease"), termToMonths("5", "years")))).toBe("60");
    expect(termToMonths("5", "months")).toBe("5");
    expect(termForDisplay("60", "years")).toBe("5");
  });
});

describe("NEW-8 — blank deal name falls back to the Tenant / Buyer at save", () => {
  it("lease: Tenant; land and building sale: Buyer", () => {
    expect(withTitleFallback(row("lease", { partyAcquirer: "Acme Logistics" })).draft.title).toBe("Acme Logistics");
    for (const t of ["land", "building_sale"]) expect(withTitleFallback(row(t, { partyAcquirer: "Buyer Co" })).draft.title).toBe("Buyer Co");
  });
  it("never overwrites a typed name, and leaves a blank alone when there is no party", () => {
    const typed = row("lease", { title: "My deal", partyAcquirer: "Acme" });
    expect(withTitleFallback(typed)).toBe(typed);
    expect(withTitleFallback(row("lease")).draft.title ?? "").toBe("");
    expect(partyNameFallback(draft("lease"))).toBe("");
  });
  it("whitespace-only name counts as blank", () => {
    expect(withTitleFallback(row("lease", { title: "   ", partyAcquirer: "Acme" })).draft.title).toBe("Acme");
  });
});

describe("NEW-7/10/11/2 — read-back, labels, party order", () => {
  it("read-back is empty while nothing is entered and non-empty after any value", () => {
    expect(footerReadback(draft("lease"))).toBe("");
    expect(footerReadback(draft("lease", { leaseSizeSf: "1000" }))).not.toBe("");
  });
  it("`Bldg Sale` everywhere the type is labelled", () => {
    expect(TYPE_OPTIONS.find((o) => o.value === "building_sale").label).toBe("Bldg Sale");
  });
  it("date labels", () => {
    expect(compDateLabel("lease")).toBe("Date signed");
    expect(compDateLabel("land")).toBe("Closing date");
    expect(moreDetailFields("building_sale").find((m) => m.col.key === "compDate").label).toBe("Closing date");
  });
  it("party labels per type", () => {
    expect(mobilePartyLabels("lease")).toEqual({ provider: "Landlord", acquirer: "Tenant" });
    expect(mobilePartyLabels("building_sale")).toEqual({ provider: "Seller", acquirer: "Buyer" });
  });
});

describe("rendered markup (rest state)", () => {
  const html = (compType, o = {}) => renderToStaticMarkup(createElement(CompEntryMobileSheet, {
    rows: [row(compType, o)], overlaysById: {}, locationCellText: () => "", onCommitField: () => {}, onSetToday: () => {},
    onResolvePeriod: () => {}, armedRowId: null, onArm: () => {}, onFocusAnchor: () => {}, onSave: () => {},
    onCancel: () => {}, saving: false, saveError: null, readyRows: [], rowIsReady: () => false, pasteBox: null,
  }));
  it("no Parties section; Tenant/Buyer then Landlord/Seller sit in Deal between Location and Size", () => {
    for (const [t, a, b] of [["lease", "Tenant", "Landlord"], ["land", "Buyer", "Seller"], ["building_sale", "Buyer", "Seller"]]) {
      const h = html(t);
      expect(h).not.toMatch(/Parties/i);
      const at = (x) => h.indexOf(`aria-label="${x}"`);
      expect(h.indexOf("Location")).toBeLessThan(at(a));
      expect(at(a)).toBeLessThan(at(b));
      expect(at(b)).toBeLessThan(at("Size"));
    }
  });
  it("Save never reads as a blocker and is not disabled; no 'Nothing entered yet'", () => {
    for (const t of ["lease", "land", "building_sale"]) {
      const h = html(t);
      expect(h).toMatch(/data-save-button="1"(?![^>]*disabled)[^>]*>Save comp</);
      expect(h).not.toMatch(/Place it on the map to save<|Pick monthly or yearly|Nothing entered yet/);
    }
  });
  it("no Details caption until an extra has a value; Add more chips otherwise", () => {
    expect(html("lease")).not.toContain(">Details<");
    expect(html("lease")).toContain(">Add more<");
    expect(html("lease", { clearHeightFt: "32" })).toContain(">Details<");
  });
  it("rate pills show once a rate exists, warn when the period is unpicked", () => {
    expect(html("lease")).not.toContain('data-pill="period"');
    const h = html("lease", { leaseRate: "2.5" });
    expect(h).toContain("/mo or /yr?");
    expect(h).toContain("Monthly or yearly? They differ by 12x.");
    expect(h).toContain('data-pill-tone="warn"');
  });
  it("a name hint shows when blank with a party", () => {
    expect(html("lease", { partyAcquirer: "Acme Logistics" })).toContain("Will save as “Acme Logistics”");
    expect(html("lease", { title: "Typed", partyAcquirer: "Acme" })).not.toContain("Will save as");
  });
});
