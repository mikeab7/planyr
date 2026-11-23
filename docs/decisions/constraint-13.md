# Owner product constraint #13

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

13. **(2026-10-04) Review opens files in TABS, is BLANK when none are open, and the open tabs FOLLOW HIS ACCOUNT between
    devices.** Michael, verbatim: "it should just be blank, and act like bluebeam with multiple tabs left open if I left
    tabs open" — this REPLACES the #1920 sheet-index empty state (no heading, buttons, "Pick a project" or sheet index in the
    blank state) and the #1926 Close (×) (closing is the tab's ×). Then, the same day, superseding his first answer of "per
    device, like Bluebeam": open tabs (files, order, active tab, page and zoom) are saved to his account so the phone shows what
    the desktop left open. Last change wins; a Word/txt tab with unsaved edits on a device is never removed by another
    device; signed out/offline falls back to the local copy. Stored in the existing `profiles.prefs` (`reviewTabs`) — never a
    new table. Do not reintroduce a landing screen or per-device-only tabs. (See B2058144.)
