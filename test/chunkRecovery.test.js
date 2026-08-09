import { describe, it, expect } from "vitest";
import {
  chunkNameOf,
  noteRecoveryAttempt,
  landingReport,
  recoveryLine,
  shouldReportFailure,
  RECOVERY_EPISODE_MAX_MS,
} from "../src/app/chunkReload.js";

/* NEW-1 — THE OUTCOME THE CHUNK GUARD CHOSE, RECORDED.
 *
 * ⛔ WHAT THIS SUITE IS ACTUALLY DEFENDING, in the terms of the production data that produced it.
 * `public.client_errors` held 361 rows of `vite:preloadError` and not one recorded which of the
 * guard's three branches ran, so a silent successful rescue and a user at a dead end wrote
 * IDENTICAL evidence. Every assertion below exists to keep one of those two readings distinguishable
 * from the other. The one that matters most is the pair `landed` + `recovered`: a rescue's whole
 * mechanism is that the page NAVIGATES, so the tab that could report success is destroyed by the
 * fix, and only a record that survives the reload can ever say it worked.
 */

describe("chunkNameOf — the failing chunk's identity", () => {
  it("pulls the hashed filename out of the browser's message", () => {
    expect(chunkNameOf(new Error("Failed to fetch dynamically imported module: https://planyr.io/assets/terrainLayers-aE2wQGtV.js")))
      .toBe("terrainLayers-aE2wQGtV.js");
    expect(chunkNameOf("error loading dynamically imported module: /assets/SitePlannerApp-BBjfxeB1.js"))
      .toBe("SitePlannerApp-BBjfxeB1.js");
  });
  it("handles the CSS case, which the 2026-06-23 rows were", () => {
    expect(chunkNameOf(new Error("…/assets/SitePlannerApp-CIGW-MKW.css"))).toBe("SitePlannerApp-CIGW-MKW.css");
  });
  it("never throws and returns empty when there is no filename to find", () => {
    expect(chunkNameOf(null)).toBe("");
    expect(chunkNameOf({})).toBe("");
    expect(chunkNameOf(new Error("something else entirely"))).toBe("");
  });
});

describe("noteRecoveryAttempt — the episode record that survives the reload", () => {
  const chunk = "terrainLayers-aE2wQGtV.js";

  it("opens an episode on the first failure and counts a reload attempt", () => {
    const rec = noteRecoveryAttempt(null, { now: 1000, stage: "reload", chunk, build: "abc" });
    expect(rec).toMatchObject({ t0: 1000, n: 1, f: 1, b: "abc", c: chunk });
  });

  it("⛔ counts ATTEMPTS, not failures — a stuck or cooled-down decision fires no reload", () => {
    let rec = noteRecoveryAttempt(null, { now: 1000, stage: "reload", chunk });
    rec = noteRecoveryAttempt(rec, { now: 1100, stage: "stuck", chunk });
    rec = noteRecoveryAttempt(rec, { now: 1200, stage: "cooldown", chunk });
    expect(rec.n).toBe(1);   // one reload was fired, and only one
    expect(rec.f).toBe(3);   // three chunk failures happened
  });

  it("keeps the episode's start time across failures, so its duration is real", () => {
    let rec = noteRecoveryAttempt(null, { now: 1000, stage: "reload", chunk });
    rec = noteRecoveryAttempt(rec, { now: 9000, stage: "stuck", chunk });
    expect(rec.t0).toBe(1000);
    expect(rec.at).toBe(9000);
  });

  it("⛔ starts a NEW episode once the old one is ancient — otherwise one long-lived tab ratchets the count forever and every number after the first is a lie", () => {
    const old = noteRecoveryAttempt(null, { now: 1000, stage: "reload", chunk });
    const fresh = noteRecoveryAttempt(old, { now: 1000 + RECOVERY_EPISODE_MAX_MS + 1, stage: "reload", chunk });
    expect(fresh.n).toBe(1);
    expect(fresh.f).toBe(1);
    expect(fresh.t0).toBeGreaterThan(old.t0);
  });

  it("survives a corrupt record rather than propagating NaN into the count", () => {
    const rec = noteRecoveryAttempt({ t0: "junk", n: "junk", f: null }, { now: 1000, stage: "reload", chunk });
    expect(rec).toMatchObject({ t0: 1000, n: 1, f: 1 });
  });
});

describe("landingReport — the page that came back", () => {
  const rec = { t0: 1000, n: 2, f: 5, b: "oldbuild", c: "terrainLayers-aE2wQGtV.js" };

  it("reports `landed` when the page arrived via the cache-buster, with the attempt count and the build it landed on", () => {
    const r = landingReport(true, rec, { now: 4000, build: "newbuild" });
    expect(r).toMatchObject({ outcome: "landed", n: 2, f: 5, ms: 3000, from: "oldbuild", to: "newbuild" });
  });

  it("reports `left` when an episode was open but the tab escaped some other way — the user rescued themselves, and that is not the guard working", () => {
    expect(landingReport(false, rec, { now: 4000 }).outcome).toBe("left");
  });

  it("says NOTHING on an ordinary boot, so a healthy session puts no rows on the wire", () => {
    expect(landingReport(false, null, { now: 4000 })).toBe(null);
    expect(landingReport(true, {}, { now: 4000 })).toBe(null);
  });

  it("ignores an ancient record — it explains nothing about this page load", () => {
    expect(landingReport(true, rec, { now: 1000 + RECOVERY_EPISODE_MAX_MS + 1 })).toBe(null);
  });
});

describe("shouldReportFailure — the ladder that keeps a storm from becoming the noise", () => {
  /* ⛔ THE MEASURED CASE THIS EXISTS FOR. Build 53d1bac, `terrainLayers-aE2wQGtV.js`, 2026-08-06:
   * ONE wedged tab re-attempting ONE import for 2 h 20 m, arriving as 81 rows spaced exactly 10 s
   * apart — which is `DUP_MS` in clientErrors, i.e. the DEDUPE window, not the failure rate. A
   * paired event carrying a rising counter has a fresh signature every time, so it would slip that
   * dedupe entirely and write a row per cursor move. */
  it("reports every one of the first three failures", () => {
    expect([1, 2, 3].map(shouldReportFailure)).toEqual([true, true, true]);
  });
  it("then climbs a 1-2-5 ladder", () => {
    for (const n of [5, 10, 25, 50, 100, 250, 500, 1000, 2500]) expect(shouldReportFailure(n)).toBe(true);
    for (const n of [4, 6, 11, 26, 51, 99, 101, 499, 501, 1001]) expect(shouldReportFailure(n)).toBe(false);
  });
  it("stays sub-linear on a real storm — the 2h20m episode costs about ten rows, not eight hundred", () => {
    let rows = 0;
    for (let f = 1; f <= 800; f++) if (shouldReportFailure(f)) rows++;
    expect(rows).toBeLessThanOrEqual(12);
    expect(rows).toBeGreaterThanOrEqual(8);
  });
  it("refuses junk rather than reporting on it", () => {
    for (const v of [0, -1, 1.5, NaN, null, undefined, "x"]) expect(shouldReportFailure(v)).toBe(false);
  });
  it("tolerates a numeric string, because the count arrives through a JSON round-trip in sessionStorage", () => {
    expect(shouldReportFailure("5")).toBe(true);
    expect(shouldReportFailure("6")).toBe(false);
  });
});

describe("recoveryLine — the wire format", () => {
  it("names the outcome and carries the counts", () => {
    expect(JSON.parse(recoveryLine("stuck", { n: 1, f: 12, c: "x.js" }))).toEqual({ o: "stuck", n: 1, f: 12, c: "x.js" });
  });
  it("drops fields that could not be read, so absent never reads as zero", () => {
    expect(JSON.parse(recoveryLine("reload", { n: 1, c: "", from: undefined }))).toEqual({ o: "reload", n: 1 });
  });
  it("stays well inside the 2000-character message column even at its largest", () => {
    expect(recoveryLine("landed", { n: 9, f: 999, ms: 12345678, c: "a".repeat(120), from: "abcdef1", to: "1234567" }).length).toBeLessThan(300);
  });
  it("⛔ every one of the six outcomes is distinguishable — this is the whole deliverable", () => {
    const seen = new Set(["reload", "stuck", "cooldown", "landed", "recovered", "left"].map((o) => JSON.parse(recoveryLine(o)).o));
    expect(seen.size).toBe(6);
  });
});
