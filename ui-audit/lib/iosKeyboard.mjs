/* iosKeyboard — the iOS Safari keyboard, modelled for a WebKit harness (B2046224 ×3, B2088384).
 *
 * WHAT IS MODELLED (stated, because a harness that cannot say what it models cannot be trusted):
 *  · the LAYOUT viewport (position:fixed containing block) is the Playwright viewport, unchanged;
 *  · focusing a text field / textarea / select / contentEditable OPENS the keyboard (or picker);
 *    blurring every one of them closes it;
 *  · visualViewport.height = layout − keyboard; window.innerHeight returns that same number, or —
 *    `tallInner` — stands ABOVE the layout box and does not move (production telemetry from the
 *    owner's iPhone, iOS 18.7, 2026-10-04 21:12 UTC, shows innerHeight > vv.height + 120 with the
 *    keyboard up);
 *  · iOS REVEALS a field the keyboard would cover by SCROLLING THE PAGE (window.scrollY = the amount,
 *    the visual viewport pans with it), and this app's page-containment guard calls scrollTo(0, 0)
 *    to pin the page back — production telemetry shows exactly that on #/site, #/notes, #/food
 *    ("document scrolled to (0, 104…347) … pinned back"). Both halves are modelled: window.scrollY /
 *    scrollTo / scroll are overridden so the app's own guard really undoes iOS's reveal, which is the
 *    real phone's behaviour and the reason a field must be revealed by the APP.
 * The visible band is [offsetTop, offsetTop + vv.height] in layout coordinates.
 * NOT modelled: the real keyboard's animation, Safari's AutoFill bar (scored on attributes), a finger.
 */
export const KEYBOARDS = { "iPhone 15": 380, "iPhone SE": 304 }; // keys + QuickType row + ^ v ✓ accessory bar

export const IOS_MODEL = ({ kbPx, tallInner = false }) => {
  const opensKb = (el) => el && ((el.tagName === "INPUT" && !/^(range|button|submit|checkbox|radio|reset|file|color|image|hidden)$/i.test(el.type)) || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
  // On iOS the keyboard belongs to the TOP page: a frame's own viewport never shrinks. A field focused
  // inside a same-origin frame (the Schedule grid) opens the top page's keyboard.
  if (window !== window.top) {
    document.addEventListener("focusin", (e) => { if (opensKb(e.target)) setTimeout(() => { try { if (!window.top.__kb.open) window.top.__kb.set(kbPx); } catch (_) {} }, 40); });
    document.addEventListener("focusout", () => setTimeout(() => { try { window.top.__kb.maybeClose(); } catch (_) {} }, 40));
    return;
  }
  const ihDesc = Object.getOwnPropertyDescriptor(window, "innerHeight") || Object.getOwnPropertyDescriptor(Window.prototype, "innerHeight");
  const layoutH = () => ihDesc.get.call(window);
  const vv = new EventTarget();
  let kb = 0, pan = 0;
  Object.defineProperties(vv, {
    width: { get: () => innerWidth }, height: { get: () => layoutH() - kb },
    offsetTop: { get: () => pan }, offsetLeft: { get: () => 0 }, scale: { get: () => 1 },
    pageTop: { get: () => pan }, pageLeft: { get: () => 0 },
  });
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  Object.defineProperty(window, "innerHeight", { get: () => (tallInner ? layoutH() + 64 : layoutH() - kb), configurable: true });
  // iOS's page scroll (the reveal) and the app pinning it back
  for (const k of ["scrollY", "pageYOffset"]) Object.defineProperty(window, k, { get: () => pan, configurable: true });
  const scrollTo = (a, b) => {
    const y = typeof a === "object" && a ? a.top : b;
    if (!Number.isFinite(y)) return;
    pan = Math.max(0, Math.min(kb, y));
    vv.dispatchEvent(new Event("scroll")); window.dispatchEvent(new Event("scroll"));
  };
  window.scrollTo = scrollTo; window.scroll = scrollTo;
  const fire = () => { vv.dispatchEvent(new Event("resize")); vv.dispatchEvent(new Event("scroll")); };
  const opensKeyboard = opensKb;
  // the focused element, followed into same-origin frames; dy = its frame's offset in the top page
  const deep = () => {
    let el = document.activeElement, dy = 0;
    while (el && el.tagName === "IFRAME") { let d = null; try { d = el.contentDocument; } catch (_) {} if (!d) break; dy += el.getBoundingClientRect().top; el = d.activeElement; }
    return { el, dy };
  };
  window.__kbDeep = deep;
  window.__kb = { band: () => ({ top: pan, bottom: pan + layoutH() - kb }), get open() { return kb > 0; }, get px() { return kb; }, get pan() { return pan; }, iosReveals: 0 };
  window.__kb.set = (px) => {
    kb = px; pan = 0; fire();
    if (!px) { window.dispatchEvent(new Event("scroll")); return; }
    // iOS reveals a covered field by scrolling the page, then the app may pin it back
    setTimeout(() => {
      const { el: a, dy } = deep();
      if (!a || !kb) return;
      const sel = a.ownerDocument.defaultView.getSelection();
      const r = a.isContentEditable && sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : a.getBoundingClientRect();
      const need = Math.round(Math.min(kb, r.bottom + dy + 12 - (layoutH() - kb)));
      if (need > 0) { window.__kb.iosReveals++; pan = need; vv.dispatchEvent(new Event("scroll")); window.dispatchEvent(new Event("scroll")); }
    }, 80);
  };
  document.addEventListener("focusin", (e) => { if (opensKeyboard(e.target)) setTimeout(() => { if (!window.__kb.open) window.__kb.set(kbPx); }, 40); });
  window.__kb.maybeClose = () => { if (!opensKeyboard(deep().el)) window.__kb.set(0); };
  document.addEventListener("focusout", () => setTimeout(() => window.__kb.maybeClose(), 40));
};

/** Probe the focused field (layout coordinates). */
export const probeFocused = (page) => page.evaluate(() => {
  const band0 = window.__kb.band();
  const { el, dy } = window.__kbDeep();
  if (!el || el === el.ownerDocument.body) return { none: true };
  // everything below is measured in the FIELD'S OWN document; the band is shifted into it
  const band = { top: band0.top - dy, bottom: band0.bottom - dy };
  const document = el.ownerDocument;
  const sel = document.defaultView.getSelection();
  const r = el.isContentEditable && sel?.rangeCount
    ? (() => { const c = sel.getRangeAt(0).getBoundingClientRect(); return c.height ? c : el.getBoundingClientRect(); })()
    : el.getBoundingClientRect();
  const H = document.documentElement.clientHeight, W = document.documentElement.clientWidth;
  const getComputedStyle = (n) => document.defaultView.getComputedStyle(n);
  // a contentEditable body is judged by its CARET line; a field by its own box
  const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, H);
  const inBand = r.top >= band.top - 1 && r.bottom <= band.bottom + 1 && r.left >= -1 && r.right <= W + 1;
  const over = [];
  const vt = Math.max(top, band.top), vb = Math.min(bottom, band.bottom);
  if (vb > vt) for (const fy of [0.2, 0.5, 0.8]) for (const fx of [0.1, 0.5, 0.9]) {
    const x = Math.min(Math.max(r.left + r.width * fx, 1), W - 1), y = vt + (vb - vt) * fy;
    const t = document.elementFromPoint(x, y);
    if (t && !(t === el || el.contains(t) || (t.tagName === "LABEL" && t.contains(el)))) over.push(`${t.dataset?.testid || t.tagName}${typeof t.className === "string" && t.className ? "." + t.className.split(" ")[0] : ""}${t.textContent ? ` "${t.textContent.trim().slice(0, 24)}"` : ""}@${Math.round(y)}`);
  }
  // GAP: a panel pinned near the bottom that stops short of the keyboard, page showing in between
  let gap = null;
  let fx = el; while (fx && fx !== document.body && getComputedStyle(fx).position !== "fixed") fx = fx.parentElement;
  // only a layer pinned to the screen BOTTOM can leave a gap (a dropdown hanging from the top can't)
  const bottomAnchored = fx && fx !== document.body && (() => { const cs = getComputedStyle(fx); return cs.top === "auto" || fx.dataset.keyboardLifted; })();
  if (bottomAnchored && window.__kb.open) {
    const f = fx.getBoundingClientRect();
    if (f.bottom < band.bottom - 2 && f.bottom > band.bottom - 140) gap = `pinned panel ends ${Math.round(band.bottom - f.bottom)} above the keyboard`;
  }
  const ac = el.getAttribute("autocomplete") || "", nm = el.getAttribute("name") || "";
  const lbl = (el.closest("label")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60);
  return {
    kbOpen: window.__kb.open, iosReveals: window.__kb.iosReveals, inBand, over: [...new Set(over)], gap, inFrame: dy !== 0 || document !== window.document,
    detail: `field ${Math.round(r.top + dy)}–${Math.round(r.bottom + dy)} vs visible ${Math.round(band0.top)}–${Math.round(band0.bottom)}${document !== window.document ? " (inside the Schedule frame)" : ""}`,
    tag: el.tagName, type: el.type || "", ce: !!el.isContentEditable,
    ac, nm, ph: el.getAttribute("placeholder") || "", al: el.getAttribute("aria-label") || "", lbl,
    testid: el.dataset.testid || "",
  };
});

/** Draw the keyboard + accessory bar where iOS puts it, screenshot what the phone shows, remove it. */
export async function shootWithKeyboard(page, path) {
  await page.evaluate(() => {
    const { px, pan } = window.__kb;
    const H = document.documentElement.clientHeight;
    document.body.style.transform = pan ? `translateY(${-pan}px)` : "";
    let kb = document.getElementById("__ioskb");
    if (!kb) { kb = document.createElement("div"); kb.id = "__ioskb"; document.documentElement.appendChild(kb); }
    kb.style.cssText = `position:fixed;left:0;right:0;top:${H - px}px;height:${px}px;z-index:2147483647;pointer-events:none;background:#d0d3d9;font:15px -apple-system,system-ui,sans-serif;display:${px ? "block" : "none"}`;
    const keys = (row) => `<div style="display:flex;gap:6px;justify-content:center;margin:0 4px 11px">${row.split("").map((c) => `<span style="flex:1;max-width:34px;height:42px;background:#fff;border-radius:5px;box-shadow:0 1px 0 #898a8d;display:flex;align-items:center;justify-content:center">${c}</span>`).join("")}</div>`;
    kb.innerHTML = `<div style="height:44px;background:#f6f6f7;border-top:1px solid #c4c6cb;display:flex;align-items:center;padding:0 14px;gap:22px;color:#2f7cf6;font-size:20px"><span>⌃</span><span>⌄</span><span style="margin-left:auto">✓</span></div>`
      + `<div style="height:40px;display:flex;align-items:center;justify-content:space-around;color:#333;font-size:14px;border-bottom:1px solid #c4c6cb"><span>"the"</span><span>I</span><span>and</span></div><div style="padding-top:10px">${keys("qwertyuiop")}${keys("asdfghjkl")}${keys("zxcvbnm")}</div>`;
  });
  await page.screenshot({ path });
  await page.evaluate(() => { document.body.style.transform = ""; const k = document.getElementById("__ioskb"); if (k) k.style.display = "none"; });
}

// iOS contact AutoFill keys off these words in a field's attributes and the text around it.
export const CONTACT_WORDS = /(^|[^a-z])(name|title|first|last|full|given|family|nick|e-?mail|phone|tel|mobile|address|street|city|state|zip|postal|org|organi[sz]ation|company|job|contact|country|birthday|bday)([^a-z]|$)/i;
export const REAL_TOKEN = /(^|\s)(name|given-name|additional-name|family-name|nickname|username|new-password|current-password|one-time-code|organization-title|organization|street-address|address-line[1-3]|address-level[1-4]|country|country-name|postal-code|email|tel[a-z-]*|url)(\s|$)/i;
