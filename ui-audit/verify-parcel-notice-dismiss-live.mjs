/* V1725152 / B2293536 (amends B2288560) — live, signed in: the parcel "slow server" banner is bottom-centre, has a ✕, the ✕ holds
 * for the Select-parcels session and not beyond it.
 * Usage: node ui-audit/verify-parcel-notice-dismiss-live.mjs https://planyr.io [shotDir]
 * Build + served chunk hash are read in the SAME run as each verdict (house rule). Parcel hosts are held open (a hung server)
 * by request routing — the real county latency is not what is under test (same stance as verify-parcel-outage-context-live). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const shots = process.argv[3] || ".";
const OUTAGE = /parcel server is slow|Statewide parcel outlines are slow|live parcel server is unavailable/i;
const NOTICE = '[data-testid="parcel-source-notice"]';
const STATUS = '[data-testid="map-status-toast"]';
const DISMISS = '[data-testid="map-status-toast-dismiss"]';
const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
const results = [];
const rec = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); };
try {
  await assertMeasurable(page, "verify-parcel-notice-dismiss-live");
  await page.route(/\/(MapServer|FeatureServer)(\/|\?|$)/i, () => {});
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (r) => r.abort());
  await page.goto(base + "/#/site", { waitUntil: "load" });
  await page.getByTestId("map-toolbar-select-parcels").waitFor({ timeout: 40000 });
  await pacedWait(page, 2500);
  const ident = () => page.evaluate(async () => ({ build: (await (await fetch("/version.json", { cache: "no-store" })).json()).build, chunks: [...document.querySelectorAll("script[src]")].map((x) => x.src.split("/").pop()).filter((x) => /MapFinder|SitePlannerApp|index/.test(x)).slice(0, 3) }));
  const id = await ident();
  console.log("build", id.build, "chunks", id.chunks.join(","));
  const count = (sel) => page.evaluate((q) => document.querySelectorAll(q).length, sel);
  const rect = (sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; }, sel);
  const furniture = () => page.evaluate(() => [...document.querySelectorAll(".leaflet-bottom .leaflet-control")].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height }; }).filter((r) => r.w > 0 && r.h > 0));
  const hit = (a, b) => a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;
  const lots = (lat = 29.7604, lng = -95.3698) => page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 16, { animate: false }), [lat, lng]);
  const raise = async () => { await page.getByTestId("map-toolbar-select-parcels").click(); for (let i = 0; i < 30; i++) { await pacedWait(page, 1000); if ((await count(NOTICE)) && OUTAGE.test(await page.evaluate((q) => document.querySelector(q)?.textContent || "", NOTICE))) return true; } return false; };
  const cancel = () => page.getByRole("button", { name: /^Cancel$/ }).first().click();
  const vp = page.viewportSize();

  await lots();
  rec("1a banner appears with the tool on at lot zoom, hung server", await raise());
  const r = await rect(NOTICE);
  rec("1b horizontally centred on the map", !!r && Math.abs(r.x + r.w / 2 - vp.width / 2) < 3, r && `centre ${(r.x + r.w / 2).toFixed(0)} of ${vp.width}`);
  rec("1c at the bottom, clear of zoom/locate/scale furniture", !!r && r.b > vp.height - 70 && (await furniture()).every((f) => !hit(r, f)));
  const d = await rect(DISMISS);
  rec("1d ✕ present, labelled Dismiss, hit-sized", !!d && Math.min(d.w, d.h) >= 28 && (await page.locator(DISMISS).getAttribute("aria-label")) === "Dismiss");
  await page.screenshot({ path: `${shots}/1-banner-bottom-center.png` });

  await page.locator(DISMISS).click();
  await pacedWait(page, 500);
  rec("2 ✕ hides it", (await count(STATUS)) === 0);
  await page.screenshot({ path: `${shots}/2-after-dismiss.png` });

  await lots(29.7654, -95.3598); await pacedWait(page, 3000); await lots(29.55, -95.75); await pacedWait(page, 11000);
  rec("3 keeps panning at lot zoom past the 8 s guard: stays hidden", (await count(STATUS)) === 0);

  await cancel(); await pacedWait(page, 600);
  await lots();
  rec("4 Cancel → Select parcels again: shows again (new occasion)", await raise());
  await cancel(); await pacedWait(page, 1500);
  rec("5 Cancel without dismissing: clears at once", (await count(STATUS)) === 0);

  await page.setViewportSize({ width: 390, height: 700 }); await pacedWait(page, 800);
  await lots();
  rec("6a narrow window: banner raised", await raise());
  const n = await rect(NOTICE);
  rec("6b wraps inside the window, never covers zoom/locate/scale", !!n && n.x >= 0 && n.r <= 390 && (await furniture()).every((f) => !hit(n, f)), n && `x ${n.x.toFixed(0)}–${n.r.toFixed(0)}, ${n.h.toFixed(0)} tall`);
  await page.screenshot({ path: `${shots}/6-narrow.png` });

  const id2 = await ident();
  rec("build unchanged through the run (same chunks)", id2.build === id.build && id2.chunks.join() === id.chunks.join(), `build ${id2.build}`);
} finally { await s.close(); }
process.exit(results.every(Boolean) ? 0 : 1);
