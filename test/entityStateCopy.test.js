/* SHARED DATA HAS ONE SOURCE OF TRUTH — never copy it into component state (B1953792).
 *
 * The names guard (namesSingleSource.test.js) covers NAMES. This extends the same idea to every
 * other fact more than one surface can change: acreage, counts, status, owner, jurisdiction, dates,
 * account prefs, rule tables. A component that seeds `useState` from such a value (or from a
 * `read*`/`load*` of a persisted shared store) holds a copy that nothing re-syncs — the bug family
 * docs/audit-single-source-of-truth.md inventories. Grep-based, because "is this state a copy of
 * shared data?" is not decidable from types; the escape is explicit and argued:
 *   · an inline `// stale-ok: <reason>` on the same line (reason required), or
 *   · an entry below (whole-file for drafts / view prefs; exact-line for a named copy).
 * Every list may only be argued DOWN. Dead entries fail the build.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (d, out = []) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx|js)$/.test(f)) out.push(p);
  }
  return out;
};
const files = walk("src").filter((f) => !f.includes("/shared/names/"));
const lines = (f) => readFileSync(f, "utf8").split("\n");
const isComment = (l) => /^\s*(\/\/|\*|\/\*)/.test(l);

// Rule 1 — useState/useRef seeded from a field of an entity that another surface can edit.
const ENTITY_FIELDS = "acres|acreage|area|areaSf|sf|sqft|count|total|totalSf|status|stage|owner|ownerId|contact|company|jurisdiction|county|date|dueDate|closingDate|loiDate|feasibilityExpiry|price|units|role|teamId|address|apn|phase";
const STATE_FROM_ENTITY = new RegExp(`(?:useState|useRef)\\((?:\\(\\) *=> *)?[^;]*?\\b[A-Za-z_]\\w*\\??\\.(?:${ENTITY_FIELDS})\\b`);
// Rule 2 — useState seeded straight from a read*/load* of a persisted store.
const STATE_FROM_STORE_READ = /useState\((?:\(\) *=> *)?(?:read|load)[A-Z]\w*(?:\(|\))|useState\((?:read|load)[A-Z]\w*\)/;
const STALE_OK = /\/\/\s*stale-ok:\s*\S+/;

// Exact `file :: trimmed line` copies, each with WHY it is not a bug (or which item fixes it).
const KNOWN_COPIES = {
  "src/workspaces/site-planner/SitePlanner.jsx :: const [jurKey, setJurKey] = useState(() => defaultJurForCounty(restored?.county));":
    "easement jurisdiction seeded from county — fixed by B1953794 (derive at read time + persisted override)",
};
// Whole-file exemptions for rule 2: per-device VIEW prefs / drafts only that component writes,
// or stores that are re-synced by a subscribe in the same file.
const VIEW_PREF_FILES = {
  "src/app/route.js": "boot route; router owns updates",
  "src/shared/theme/ThemeProvider.jsx": "theme mode; the provider is the single writer + OS listener",
  "src/shared/ui/InterfaceSettings.jsx": "reads smoothZoom store; store notifies (shared/prefs/smoothZoom.js)",
  "src/workspaces/library/components/FileBrowser.jsx": "per-device tree open/sort prefs, single writer",
  "src/workspaces/model/ModelApp.jsx": "per-device zoom/auto-colour view prefs (org workbook index is B1953796)",
  "src/workspaces/site-planner/components/Collapse.jsx": "per-device collapse state, single writer",
  "src/workspaces/site-planner/SitePlannerApp.jsx": "sites list re-synced by storage + onProjectsChanged listeners in the same file",
  "src/shared/ui/ProjectBreadcrumb.jsx": "re-synced on open / pin subscription / storage listener in the same file",
};
// Rule-2 copies awaiting their fix; each entry is REMOVED by the item named (dead entries fail).
const PENDING_FIX_FILES = {
  "src/workspaces/site-planner/MapFinder.jsx": "acctPrefs — B1953793",
  "src/workspaces/site-planner/SitePlanner.jsx": "rule tables — B1953793 (smoothZoom/stdDraft are view prefs)",
};

const hits = (re) => {
  const out = [];
  for (const f of files) {
    lines(f).forEach((line, i) => {
      if (isComment(line) || !re.test(line)) return;
      out.push({ f, i: i + 1, t: line.trim(), ok: STALE_OK.test(line) });
    });
  }
  return out;
};

describe("no component copies shared entity data into state", () => {
  it("rule 1: no useState/useRef seeded from an entity field outside the argued lists", () => {
    const bad = hits(STATE_FROM_ENTITY)
      .filter((h) => !h.ok && !(`${h.f} :: ${h.t}` in KNOWN_COPIES))
      .map((h) => `${h.f}:${h.i}: ${h.t}`);
    expect(bad, "read it from the one source (selector/store), or add `// stale-ok: <reason>`").toEqual([]);
  });

  it("rule 2: no useState seeded from a read*/load* of a persisted store outside the argued lists", () => {
    const bad = hits(STATE_FROM_STORE_READ)
      .filter((h) => !h.ok && !VIEW_PREF_FILES[h.f] && !PENDING_FIX_FILES[h.f])
      .map((h) => `${h.f}:${h.i}: ${h.t}`);
    expect(bad, "subscribe to the store (useSyncExternalStore) instead of seeding a copy").toEqual([]);
  });

  it("a `stale-ok` escape must carry a reason", () => {
    const bare = [];
    for (const f of files) lines(f).forEach((l, i) => { if (/\/\/\s*stale-ok:?\s*$/.test(l)) bare.push(`${f}:${i + 1}`); });
    expect(bare).toEqual([]);
  });

  it("the argued lists have no dead entries", () => {
    const r1 = new Set(hits(STATE_FROM_ENTITY).map((h) => `${h.f} :: ${h.t}`));
    for (const k of Object.keys(KNOWN_COPIES)) expect(r1.has(k), `dead KNOWN_COPIES entry: ${k}`).toBe(true);
    const r2 = new Set(hits(STATE_FROM_STORE_READ).map((h) => h.f));
    for (const f of [...Object.keys(VIEW_PREF_FILES), ...Object.keys(PENDING_FIX_FILES)]) {
      expect(r2.has(f), `dead rule-2 entry (fixed or moved?): ${f}`).toBe(true);
    }
  });

  it("CLAUDE.md states the rule for ALL shared data, not just names", () => {
    expect(readFileSync("CLAUDE.md", "utf8")).toMatch(/never copy shared data into component state/i);
  });
});

describe("the guard has teeth", () => {
  it("flags a seeded copy and passes a subscribed read", () => {
    expect(STATE_FROM_ENTITY.test("const [ac] = useState(site.acres);")).toBe(true);
    expect(STATE_FROM_ENTITY.test("const [ac] = useState(() => defaultJurForCounty(restored?.county));")).toBe(true);
    expect(STATE_FROM_ENTITY.test("const [open, setOpen] = useState(false);")).toBe(false);
    expect(STATE_FROM_STORE_READ.test("const [p, setP] = useState(() => readMirror());")).toBe(true);
    expect(STATE_FROM_STORE_READ.test("const [rules] = useState(loadFloodplainRules);")).toBe(true);
    expect(STATE_FROM_STORE_READ.test("const p = useSyncExternalStore(subscribe, readMirror);")).toBe(false);
  });
});
