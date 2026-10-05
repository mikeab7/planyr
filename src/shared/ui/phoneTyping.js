/* phoneTyping — B2088384: typing anywhere in Planyr on a phone. Two app-wide guarantees, installed
 * ONCE (main.jsx), so no field has to remember them:
 *
 * 1. NO CONTACT AUTOFILL ON A FIELD THAT ISN'T A CONTACT FIELD. iOS Safari offers "AutoFill Contact"
 *    from a field's autocomplete token, name, id, label and placeholder, and it largely IGNORES
 *    `autocomplete="off"` (measured on the owner's iPhone in Food, B2046224 ×2). So every text field
 *    that does not declare a REAL autocomplete token gets a non-standard one (`x-planyr`) and a
 *    neutral `name`, stamped on the touch that is about to focus it (touchstart/pointerdown, i.e.
 *    BEFORE iOS decides what to offer) and again on focus. Fields that DO carry a real token —
 *    sign-in email/password, sign-up and profile names, organization — are left exactly alone:
 *    they ARE contact/credential fields and AutoFill there is wanted. A field can also opt out with
 *    `data-contact-field`.
 *
 * 2. THE FIELD YOU TYPE IN STAYS ABOVE THE KEYBOARD. On iOS the keyboard does not shrink the layout
 *    viewport; iOS tries to reveal the field by scrolling the page, and this app's page-containment
 *    guard pins the page back (html/body are pinned — B1168128), which production telemetry shows
 *    happening on #/site, #/notes and #/food. So the app reveals the field ITSELF, while the keyboard
 *    is up and again after every keystroke (typing can move a field — a filter shrinks the dialog
 *    around it): it scrolls the field (or its whole `[data-edit-card]` when that fits) into the
 *    visible part of the screen through its own scrolling containers; a dialog BACKDROP reaching the
 *    screen bottom is stopped at the keyboard's top edge and its dialog capped to that height with its
 *    own scroll; a smaller pinned panel (a popover near the bottom, a dock) is lifted above the
 *    keyboard. Everything is put back when typing ends. A surface that manages the keyboard itself
 *    opts out with `data-keyboard-managed` (the Food sheet); one that only POSITIONS itself above the
 *    keyboard and wants its fields scrolled into view says `data-keyboard-managed="position"` (the
 *    Site Planner phone Properties sheet — lifting it as well raced its own rise and sent it off the top). contentEditable bodies (Notes, the Review
 *    doc editor) are left to their own caret handling. Focus inside a same-origin IFRAME (the Schedule
 *    grid, public/sequence/) is followed in: on iOS the keyboard only ever shrinks the TOP page's
 *    visual viewport, so the frame cannot see it — this module, in the top page, does it for it.
 *
 * Layout height is MEASURED (shared/ui/layoutViewport.js), never `innerHeight` — on iOS innerHeight
 * moves both ways with the keyboard (B2046224 ×2/×3). The harness that proves all of this on every
 * field it can reach is ui-audit/verify-phone-typing.mjs. */
import { layoutViewportHeight } from "./layoutViewport.js";

const KEYBOARD_MIN_PX = 120;
const MARGIN = 12;
const TEXT_TYPES = /^(text|search|email|url|tel|number|password|date|time|datetime-local|month|week)$/i;
// Real autocomplete tokens (WHATWG autofill field names). A field carrying one of these meant it.
const REAL_TOKEN = /(^|\s)(name|honorific-prefix|given-name|additional-name|family-name|honorific-suffix|nickname|username|new-password|current-password|one-time-code|organization-title|organization|street-address|address-line[1-3]|address-level[1-4]|country|country-name|postal-code|cc-[a-z-]+|transaction-[a-z]+|language|bday[a-z-]*|sex|url|photo|tel[a-z-]*|email|impp|webauthn)(\s|$)/i;

export function isTextEntry(el) {
  if (!el || !el.tagName) return false;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "SELECT") return true;
  return el.tagName === "INPUT" && TEXT_TYPES.test(el.type || "text");
}

/** PURE — what a field's autofill attributes should become (null = leave it alone). */
export function autofillStamp({ tagName, type = "text", autocomplete = "", name = "", contactField = false }) {
  if (contactField || tagName === "SELECT") return null;
  if (tagName === "INPUT" && /^password$/i.test(type) && /(current|new)-password/i.test(autocomplete)) return null;
  const ac = (autocomplete || "").trim();
  if (ac && ac !== "off" && ac !== "on" && REAL_TOKEN.test(ac)) return null; // a genuine contact/credential field
  if (/^x-/.test(ac)) return name ? null : { name: "planyr-field" }; // already stamped (e.g. Food's own x-food-*)
  return { autocomplete: "x-planyr", ...(name ? {} : { name: "planyr-field" }) };
}

function stamp(el) {
  if (!isTextEntry(el) || el.dataset.planyrStamped !== undefined) return;
  const next = autofillStamp({
    tagName: el.tagName, type: el.type, autocomplete: el.getAttribute("autocomplete") || "",
    name: el.getAttribute("name") || "", contactField: el.hasAttribute("data-contact-field"),
  });
  el.dataset.planyrStamped = "";
  if (!next) return;
  if (next.autocomplete) el.setAttribute("autocomplete", next.autocomplete);
  if (next.name) el.setAttribute("name", next.name);
  el.setAttribute("data-1p-ignore", "");
  el.setAttribute("data-lpignore", "true");
  el.setAttribute("data-form-type", "other");
}

/** PURE — the visible band (layout coordinates) while the keyboard is up, or null when it is down. */
export function keyboardBand({ layoutHeight, vvHeight, vvOffsetTop = 0 }) {
  if (![layoutHeight, vvHeight, vvOffsetTop].every(Number.isFinite)) return null;
  if (layoutHeight - vvHeight - vvOffsetTop <= KEYBOARD_MIN_PX) return null;
  return { top: vvOffsetTop, bottom: vvOffsetTop + vvHeight };
}

/** PURE — how far (px, + = down) a box must move so it sits inside [lo, hi]; prefers showing its top. */
export function revealDelta(rect, lo, hi) {
  if (rect.top < lo) return rect.top - lo;
  if (rect.bottom > hi) return Math.min(rect.bottom - hi, rect.top - lo);
  return 0;
}

export function installPhoneTyping(win = typeof window !== "undefined" ? window : undefined) {
  if (!win || !win.document || win.__PLANYR_PHONE_TYPING) return () => {};
  win.__PLANYR_PHONE_TYPING = true;
  const doc = win.document;
  const lifted = new Map(); // fixed element → its original inline transform
  const fitted = new Map(); // a backdrop / its dialog → their original inline sizing

  // ── geometry that crosses same-origin iframe boundaries, in TOP-page coordinates ──
  const styleOf = (n) => n.ownerDocument.defaultView.getComputedStyle(n);
  const frameDy = (n) => {
    let dy = 0, w = n.ownerDocument.defaultView;
    while (w && w !== win) { const fe = w.frameElement; if (!fe) break; dy += fe.getBoundingClientRect().top; w = w.parent; }
    return dy;
  };
  const rectOf = (n) => { const r = n.getBoundingClientRect(); const dy = frameDy(n); return { top: r.top + dy, bottom: r.bottom + dy, height: r.height }; };
  const parentOf = (n) => n.parentElement || n.ownerDocument.defaultView.frameElement || null;
  const isScroller = (n) => /(auto|scroll)/.test(styleOf(n).overflowY) && n.scrollHeight > n.clientHeight + 1;

  const band = () => {
    const vv = win.visualViewport;
    if (!vv) return null;
    return keyboardBand({ layoutHeight: layoutViewportHeight(win), vvHeight: vv.height, vvOffsetTop: vv.offsetTop || 0 });
  };
  const restoreLifted = () => {
    for (const [el, t] of lifted) { el.style.transform = t; delete el.dataset.keyboardLifted; }
    lifted.clear();
    for (const { el, style } of fitted.values()) { Object.assign(el.style, style); delete el.dataset.keyboardFitted; }
    fitted.clear();
  };

  const attached = new WeakSet();
  const deepActive = () => {
    let el = doc.activeElement;
    while (el && el.tagName === "IFRAME") {
      let d = null;
      try { d = el.contentDocument; } catch (_) { return null; } // cross-origin: not ours to manage
      if (!d) return null;
      attachDoc(d);
      el = d.activeElement;
    }
    return el;
  };

  const reveal = () => {
    const el = deepActive();
    const b = band();
    if (!b) { restoreLifted(); return; }
    if (!isTextEntry(el)) return;
    const managed = el.closest("[data-keyboard-managed]");
    if (managed && managed.dataset.keyboardManaged !== "position") return; // the surface does all of it
    // "position": the surface already sits itself above the keyboard (the Site Planner phone sheet) —
    // only scroll the field into view inside it; never resize or lift it (that raced its own rise)
    const card = el.closest("[data-edit-card]");
    const target = () => {
      const f = rectOf(el);
      if (!card) return f;
      const c = rectOf(card);
      return c.height <= b.bottom - b.top - 2 * MARGIN ? c : f;
    };
    // 1. scroll through the field's own scrolling containers, innermost first (crossing out of a frame)
    for (let n = parentOf(el); n && n !== doc.body && n !== doc.documentElement; n = parentOf(n)) {
      if (n === n.ownerDocument.body || !isScroller(n)) continue;
      const box = rectOf(n);
      // a header PINNED inside this scroller (position: sticky, currently stuck at its top) covers
      // whatever scrolls under it — keep the field below it (measured: the Standards panel's intro
      // line sat over a drop-down on an iPhone SE)
      let stuck = 0;
      for (const c of n.children) {
        const kids = [c, ...c.children];
        for (const k of kids) {
          if (k.contains(el) || styleOf(k).position !== "sticky") continue;
          const kr = rectOf(k);
          if (kr.height && Math.abs(kr.top - box.top) <= 2) stuck = Math.max(stuck, kr.bottom - box.top);
        }
      }
      const lo = Math.max(b.top, box.top + stuck) + MARGIN, hi = Math.min(b.bottom, box.bottom) - MARGIN;
      if (hi - lo < 8) continue;
      const d = revealDelta(target(), lo, hi);
      if (d) n.scrollTop += d;
    }
    // 2. still under the keyboard? the field is in a layer a scroll can't move
    if (managed) return;
    const r = target();
    const over = r.bottom - (b.bottom - MARGIN);
    if (over <= 0) return;
    const layoutH = layoutViewportHeight(win);
    // 2a. a dialog BACKDROP (a fixed or absolute layer of the top page reaching the screen bottom, at
    //     least half the screen tall): stop it at the keyboard's top edge, and cap the dialog inside it
    //     to that height with its own scroll — then step 1, re-run, scrolls the dialog to the field.
    for (let n = parentOf(el), child = el; n && n !== doc.body; child = n, n = parentOf(n)) {
      if (n.ownerDocument !== doc) continue;
      const pos = styleOf(n).position;
      if (pos !== "fixed" && pos !== "absolute") continue;
      const nr = n.getBoundingClientRect();
      // a BACKDROP spans the screen's width; a side drawer reaching the bottom is not one — shrinking a
      // drawer left its own list a sliver tall on an iPhone SE (its header and footer took the rest)
      if (nr.bottom < layoutH - 2 || nr.height < layoutH / 2 || nr.width < win.innerWidth * 0.9 || fitted.has(n)) continue;
      // …and a backdrop HOLDS A DIALOG: a role="dialog"/aria-modal between it and the field, or a card
      // narrower than it. A full-screen APP layer (the Site Planner's own root) is neither — fitting it
      // shrank the whole planner to the strip above the keyboard (measured, B2088384).
      const cr = child.getBoundingClientRect();
      let holdsDialog = cr.width < nr.width - 16;
      for (let m = el; m && m !== n && !holdsDialog; m = parentOf(m)) {
        if (m.getAttribute && (m.getAttribute("role") === "dialog" || m.getAttribute("aria-modal") === "true")) holdsDialog = true;
      }
      if (!holdsDialog) continue;
      const cbBottom = pos === "fixed" ? layoutH : (n.offsetParent || doc.documentElement).getBoundingClientRect().bottom;
      fitted.set(n, { el: n, style: { bottom: n.style.bottom, height: n.style.height, maxHeight: n.style.maxHeight } });
      Object.assign(n.style, { bottom: `${Math.max(0, cbBottom - b.bottom)}px`, height: "auto", maxHeight: "none" });
      if (child !== el && child.ownerDocument === doc && child.tagName !== "IFRAME") {
        fitted.set(child, { el: child, style: { maxHeight: child.style.maxHeight, overflowY: child.style.overflowY } });
        Object.assign(child.style, { maxHeight: `${Math.max(120, b.bottom - Math.max(b.top, nr.top) - 2 * MARGIN)}px`, overflowY: "auto" });
      }
      n.dataset.keyboardFitted = "";
      setTimeout(reveal, 30);
      return;
    }
    // 2b. a smaller pinned panel (a popover near the bottom, a dock): lift it above the keyboard
    let fixed = null;
    for (let n = el; n && n !== doc.body; n = parentOf(n)) {
      if (n.ownerDocument === doc && styleOf(n).position === "fixed") { fixed = n; break; }
    }
    if (!fixed || fitted.has(fixed)) return;
    const fr = fixed.getBoundingClientRect();
    const lift = Math.min(over, Math.max(0, fr.top - b.top)); // never past the top of the visible area
    if (lift <= 0) return;
    if (!lifted.has(fixed)) lifted.set(fixed, fixed.style.transform || "");
    const base = lifted.get(fixed);
    const prev = Number(fixed.dataset.keyboardLifted || 0);
    fixed.dataset.keyboardLifted = String(prev + lift);
    fixed.style.transform = `${base} translateY(${-(prev + lift)}px)`.trim();
  };

  let timers = [];
  const revealSoon = () => {
    timers.forEach(clearTimeout);
    timers = [0, 120, 320, 650].map((ms) => setTimeout(reveal, ms));
  };
  const onTouch = (e) => { const t = e.target; if (t && t.nodeType === 1) stamp(t.closest("input, textarea") || t); };
  const onFocusIn = (e) => {
    const t = e.target;
    if (t && t.tagName === "IFRAME") { try { if (t.contentDocument) attachDoc(t.contentDocument); } catch (_) { /* cross-origin */ } }
    stamp(t);
    if (isTextEntry(t) || (t && t.tagName === "IFRAME")) revealSoon();
  };
  const onFocusOut = () => setTimeout(() => { if (!isTextEntry(deepActive())) restoreLifted(); }, 0);
  // typing can move the field (a filter shrinks the dialog around it, which re-centres it) — re-check
  const onInput = (e) => { if (isTextEntry(e.target)) revealSoon(); };

  function attachDoc(d) {
    if (!d || attached.has(d)) return;
    attached.add(d);
    d.addEventListener("touchstart", onTouch, { capture: true, passive: true });
    d.addEventListener("pointerdown", onTouch, { capture: true, passive: true });
    d.addEventListener("focusin", onFocusIn, true);
    d.addEventListener("focusout", onFocusOut, true);
    d.addEventListener("input", onInput, true);
  }
  attachDoc(doc);
  // a same-origin frame (the Schedule grid) gets the same listeners as soon as it loads, so its very
  // first tap is stamped before iOS decides what to offer
  doc.addEventListener("load", (e) => { const t = e.target; if (t && t.tagName === "IFRAME") { try { attachDoc(t.contentDocument); } catch (_) { /* cross-origin */ } } }, true);
  const vv = win.visualViewport;
  vv?.addEventListener("resize", revealSoon);
  vv?.addEventListener("scroll", revealSoon);
  win.addEventListener("planyr:viewport-healed", revealSoon);
  return () => {
    vv?.removeEventListener("resize", revealSoon);
    vv?.removeEventListener("scroll", revealSoon);
    win.removeEventListener("planyr:viewport-healed", revealSoon);
    restoreLifted();
    delete win.__PLANYR_PHONE_TYPING;
  };
}
