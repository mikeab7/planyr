/* foodListsKit — the shared "restaurant lists don't break the frame" probe (NEW-1 / B2088288), used by
 * verify-food-phone (portrait, WebKit iPhone + desktop) and verify-food-landscape (sideways). It makes a list
 * through the REAL UI (the chip strip's "+ New"), selects it, and then asserts the toolbar is still exactly one screen
 * wide: no sideways page scroll, the Map | List switch and the search field fully on screen and the topmost thing at
 * their own centre, the chip strip + the list card inside the visible screen, clear of the basemap switch and the
 * zoom stack, and below the header (no second header row). `report(name, ok, detail)` is the caller's row/check fn. */
export async function listsLayoutProbe(page, report, tag) {
  const touch = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  const act = async (loc) => (touch ? loc.tap() : loc.click());
  await act(page.locator('[data-testid="food-list-new"]'));
  await page.locator('[data-testid="food-list-new-input"]').fill("Lunch @ Work");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-testid="food-list-panel"]', { timeout: 8000 });
  await page.evaluate(() => { document.activeElement?.blur?.(); window.__setKeyboard?.(0); window.__kb?.set(0); }); // the name field is gone — drop the emulated keyboard
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const vv = window.visualViewport; const W = vv ? vv.width : innerWidth; const H = vv ? vv.height : innerHeight;
    const q = (s) => document.querySelector(s);
    const btn = (t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
    const hit = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && (e === el || el.contains(e)); };
    const map = btn("Map"), list = btn("List"), input = q('[data-testid="food-search-box"]');
    const chips = q('[data-testid="food-list-chips"]'), panel = q('[data-testid="food-list-panel"]');
    const base = q('[data-testid="food-basemap-toggle"]'), zoom = q(".leaflet-control-zoom"), host = q('[data-testid="food-map"]');
    return {
      W, H, scrollX: document.documentElement.scrollWidth > innerWidth + 1,
      map: rect(map), list: rect(list), input: rect(input), chips: rect(chips), panel: rect(panel), base: rect(base), zoom: rect(zoom), host: rect(host),
      hit: [hit(map), hit(list), hit(input)], chipsHit: hit(q('[data-testid="food-list-chip-all"]')),
      selected: q('[data-testid="food-list-chip"][aria-pressed="true"]')?.innerText?.trim() || null,
    };
  });
  const inView = (r) => r && r.l >= -0.5 && r.r <= m.W + 0.5 && r.t >= -0.5 && r.b <= m.H + 0.5;
  const apart = (a, b) => !a || !b || a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t + 0.5 || b.b <= a.t + 0.5;
  const d = JSON.stringify({ W: m.W, H: m.H, chips: m.chips, panel: m.panel });
  report(`${tag} — lists: a list is selected (chip pressed, card open)`, m.selected === "Lunch @ Work" && !!m.panel, String(m.selected));
  report(`${tag} — lists: still exactly one screen wide (no sideways page scroll)`, !m.scrollX, `scrollX=${m.scrollX}`);
  report(`${tag} — lists: Map | List switch and the search field fully on screen and hittable`, inView(m.map) && inView(m.list) && inView(m.input) && m.hit.every(Boolean), JSON.stringify({ map: m.map, list: m.list, input: m.input, hit: m.hit }));
  report(`${tag} — lists: chip strip and card inside the visible screen`, inView(m.chips) && inView(m.panel), d);
  report(`${tag} — lists: chip strip sits BELOW the header row (no second header row)`, m.chips.t >= m.host.t - 0.5 && m.chips.t >= m.input.b - 0.5, `chips top ${Math.round(m.chips.t)} vs header bottom ${Math.round(m.input.b)}`);
  report(`${tag} — lists: strip + card clear of the basemap switch and the zoom stack`, apart(m.chips, m.base) && apart(m.panel, m.base) && apart(m.chips, m.zoom) && apart(m.panel, m.zoom), JSON.stringify({ chips: m.chips, panel: m.panel, base: m.base, zoom: m.zoom }));
  report(`${tag} — lists: the chip strip is tappable (topmost at its own centre)`, m.chipsHit, "");
}
