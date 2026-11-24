/* menuRoving.js — the keyboard rule for a menu's rows (audit M2): ArrowDown / ArrowUp move focus to the next / previous
 * enabled row and WRAP at the ends; Home / End jump to the first / last. Pure (no DOM) so it is unit-tested in node.
 * `index` is the row that has focus now (-1 = none); `count` is the number of enabled rows. Returns the row to focus, or
 * null when the key is not a roving key (or there are no rows). */
export function nextMenuIndex(key, index, count) {
  if (!count || count < 1) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return index < 0 || index >= count ? 0 : (index + 1) % count;
  if (key === "ArrowUp") return index < 0 || index >= count ? count - 1 : (index - 1 + count) % count;
  return null;
}

/* The rows a menu panel rolls focus through: its enabled buttons and menu-role items, in document order. */
export const MENU_ROW_SELECTOR = 'button:not([disabled]),[role="menuitem"]:not([aria-disabled="true"]),[role="menuitemradio"]:not([aria-disabled="true"]),[role="menuitemcheckbox"]:not([aria-disabled="true"])';
