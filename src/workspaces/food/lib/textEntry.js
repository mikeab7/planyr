/* textEntry — "does focusing this element put a keyboard (or a picker wheel) on screen?" (NEW-6, 2026-10-23).
 *
 * BottomSheet's `typing` state (sheet pins to the visual viewport, "Log a visit" and every sticky bar step aside so the card being
 * edited is fully visible) was keyed on the tag alone — INPUT|TEXTAREA|SELECT — so FOCUSING A RATING SLIDER (an <input type=range>) switched it
 * on: the form's pinned Cancel / Log row un-stuck and rode off the bottom of the sheet the moment a slider had focus, with no keyboard anywhere.
 * A range, checkbox, radio, button-like or file input never opens a keyboard. Text-like inputs, date, select and textarea do (iOS draws a
 * wheel for a date / select, which covers the sheet exactly like a keyboard). Same rule as the iOS model in ui-audit/lib/foodIosPage.mjs. */
const NO_KEYBOARD = /^(range|button|submit|checkbox|radio|reset|file|color|image|hidden)$/i;

export function opensKeyboard(el) {
  if (!el || !el.tagName) return false;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName === "INPUT") return !NO_KEYBOARD.test(el.type || "text");
  return false;
}
