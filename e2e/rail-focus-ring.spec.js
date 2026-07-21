/* B927 (NEW-5) — one shared interaction-state definition means EVERY rail / toolbar / menu control
 * shows a visible keyboard-focus ring. The ring is defined once in index.css
 * (button/[role=button]/[role=menuitem]:focus-visible → a 2px --focus-ring outline; inputs also get
 * a box-shadow ring). This spec drives a real keyboard-tab walk of the Site Planner chrome LOGGED
 * OUT and asserts that every interactive stop it lands on carries a visible focus indicator — the
 * keyboard-operability guarantee that was previously unverified. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

// Read the currently-focused element + whether it shows a visible focus indicator (outline OR the
// input box-shadow ring). Returns null when focus is on <body> / nothing.
function activeFocusInfo(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    const outlineW = parseFloat(cs.outlineWidth) || 0;
    const hasOutline = outlineW >= 1 && cs.outlineStyle !== "none";
    const hasShadow = !!cs.boxShadow && cs.boxShadow !== "none";
    const interactive = el.tagName === "BUTTON" || el.tagName === "INPUT" || el.tagName === "SELECT" ||
      el.getAttribute("role") === "button" || el.getAttribute("role") === "menuitem" || el.getAttribute("role") === "tab";
    return {
      label: el.getAttribute("aria-label") || el.getAttribute("data-testid") || (el.textContent || "").trim().slice(0, 24) || el.tagName,
      interactive, visible, ring: hasOutline || hasShadow,
    };
  });
}

test.describe("keyboard focus ring on every rail/toolbar/menu control (logged out)", () => {
  test("tab-walking the chrome lands a visible focus indicator on every interactive stop", async ({ page }) => {
    await startBlank(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});

    let interactiveStops = 0;
    const missing = [];
    // Walk a generous slice of the tab order; every visible interactive stop must show a ring.
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const info = await activeFocusInfo(page);
      if (!info || !info.visible || !info.interactive) continue;
      interactiveStops++;
      if (!info.ring) missing.push(info.label);
    }

    // The walk actually exercised controls…
    expect(interactiveStops, "should have tab-stopped on several interactive controls").toBeGreaterThanOrEqual(6);
    // …and NONE of them was missing a visible focus indicator.
    expect(missing, `controls with no visible focus ring: ${missing.join(", ")}`).toEqual([]);
  });
});
