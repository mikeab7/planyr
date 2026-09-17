/* verify-merge-toast.mjs — NEW-1 (B1735728/V1243392 follow-on, 2026-09-17).
 *
 * B1735728 fixed the false "newer version" banner / inflated merge toast (the owner's report:
 * editing ONE schedule produced a toast reading "687 tasks updated in Goose Creek / Master
 * Schedule, Grand Port / Master Schedule, +7 more"). The fix shipped sandbox-proven at the
 * pure-function/storage-layer level (test/schedulerEngine.test.js, test/schedulerSaveQueue.test.js)
 * but the merge TOAST ITSELF — the real `showToast` call, in a real running tab, produced by the
 * real `_rawSet`/`mergeCloudDoc`/`countChangedTaskRows`/`changedProjectIds` code in
 * public/sequence/index.html — had never been observed firing. The V1243392 steps call for two
 * hand-driven browser tabs (one editing, one idle), which is exactly what this repo's sandbox
 * cannot drive: the scheduler grid is an iframe whose "Switch schedule" / "Duplicate" popovers
 * don't respond to a driven click here, so anything depending on reaching them isn't viable from
 * an automated browser session (see the dispatch's own instrument-facts note).
 *
 * This harness proves the toast without a second tab and without touching Michael's real account:
 * ONE real browser tab loads the REAL, BUILT /sequence/ page, talking to a fully-mocked
 * planar_data/planar_history/client_errors backend (Playwright route interception — no real
 * Supabase, no auth needed, nothing leaves the process). "Another device's write" is injected by
 * directly mutating the mock's stored row between two real, UI-driven edits in the SAME tab — the
 * second edit's own real save (`attemptCloudSave` -> `window.storage.set` -> `_rawSet`) discovers
 * the mock's now-newer row exactly the way a real cloud row from another device would present
 * itself, and runs the REAL merge/toast code, not a re-derivation of it.
 *
 * Five cases, matching the dispatch:
 *   1. one field changed in one schedule           -> toast names that one schedule, count 1
 *   2. a row inserted mid-schedule                  -> count is 1 (the real add), never "every
 *                                                       row below the insert" (the id-churn bug)
 *   3. a project added                               -> toast names the new schedule, count 1
 *   4. a project removed                             -> count is 1, no crash, no stale banner
 *   5. a view-only change alone (task.focused)       -> no toast, no cloud write at all
 * Every firing case also asserts the client_errors telemetry row this same item adds (NEW-1) —
 * module "scheduler", source "event:merge-toast", carrying the toast's own schedule list + count.
 *
 * Run:  npm run build && npx vite preview --port 4173 &   then   node ui-audit/verify-merge-toast.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const SUPABASE_HOST = "https://lyeqzkuiwngunutlkkmi.supabase.co";
const SUPABASE_UMD = new URL("../node_modules/@supabase/supabase-js/dist/umd/supabase.js", import.meta.url).pathname;
const supaJs = readFileSync(SUPABASE_UMD, "utf8");

const results = [];
const check = (label, pass, detail = "") => {
  results.push({ label, pass });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${label}${detail ? "  · " + detail : ""}`);
};

// ── A fully-mocked planar_data / planar_history / client_errors backend ──────────────────────
// Answers every request to the REAL, hardcoded Supabase host this page talks to — nothing here
// ever reaches lyeqzkuiwngunutlkkmi.supabase.co. `.setForeignRow` is the "inject a known foreign
// revision" primitive: it mutates the mock's stored row directly, standing in for a write another
// device made, with NO second browser tab involved.
function json(route, body, status = 200) {
  return route.fulfill({
    status, contentType: "application/json",
    headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" },
    body: JSON.stringify(body),
  });
}
function makeBackend() {
  const rows = {};
  const upserts = [];
  const clientErrors = [];
  const handle = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": "*", "access-control-allow-methods": "*", "access-control-allow-headers": "*",
      }, body: "" });
    }
    if (url.pathname === "/rest/v1/planar_data") {
      const k = (url.searchParams.get("key") || "").replace(/^eq\./, "");
      if (req.method() === "GET") {
        const select = url.searchParams.get("select") || "";
        const row = rows[k];
        if (!row) return json(route, { code: "PGRST116", details: "Results contain 0 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" }, 406);
        if (select.includes("__rev")) {
          const rev = row.value && typeof row.value === "object" ? row.value.__rev : null;
          return json(route, { rev: rev == null ? null : String(rev) });
        }
        return json(route, { value: row.value });
      }
      if (req.method() === "POST") {
        let body; try { body = JSON.parse(req.postData() || "null"); } catch { body = null; }
        const rec = Array.isArray(body) ? body[0] : body;
        if (rec && rec.key) { rows[rec.key] = { key: rec.key, value: rec.value }; upserts.push({ key: rec.key, rev: rec.value && rec.value.__rev }); }
        return json(route, [], 201);
      }
    }
    if (url.pathname === "/rest/v1/planar_history") {
      return json(route, req.method() === "GET" ? [] : [], req.method() === "GET" ? 200 : 201);
    }
    if (url.pathname === "/rest/v1/client_errors" && req.method() === "POST") {
      let body; try { body = JSON.parse(req.postData() || "null"); } catch { body = null; }
      clientErrors.push(Array.isArray(body) ? body[0] : body);
      return json(route, [], 201);
    }
    return json(route, {});
  };
  return {
    rows, upserts, clientErrors, handle,
    setForeignRow(key, value) { rows[key] = { key, value }; },
  };
}

// ── Fixture builders — real task/project shapes (mirrors public/sequence/index.html's own) ───
const task = (id, name, start, end, duration, extra = {}) => ({
  id, name, start, end, duration, predecessors: [], health: "gray", percentComplete: 0,
  parentId: null, responsibleParty: "", notes: [], isExpanded: true, ...extra,
});
function seedDoc() {
  return {
    nPid: 3, nTid: { 1: 4, 2: 2 }, aPid: 1, view: "grid", section: "projects", editProjId: null, healthColStyle: "stoplight",
    settings: { defaultSplit: 60, snapDefault: true, holidays: {
      newYearsDay:true,mlkDay:false,presidentsDay:false,memorialDay:true,juneteenth:false,independence:true,laborDay:true,
      columbusDay:false,veteransDay:false,thanksgiving:true,dayAfterThanksgiving:false,christmasEve:true,christmas:true,newYearsEve:false,
    }, customHealth: [], healthLabelOverrides: {} },
    projects: {
      1: { id: 1, name: "Master Schedule", tasks: [
        task(1, "Task Alpha", "2026-01-05", "2026-01-09", 5),
        task(2, "Task Beta",  "2026-01-12", "2026-01-16", 5),
        task(3, "Task Gamma", "2026-01-19", "2026-01-23", 5),
      ] },
      2: { id: 2, name: "Grand Port / Master Schedule", tasks: [
        task(1, "Kickoff", "2026-01-05", "2026-01-05", 1),
      ] },
    },
    __rev: 1,
  };
}
function seedDocWithParentChild() {
  return {
    nPid: 3, nTid: { 1: 4 }, aPid: 1, view: "grid", section: "projects", editProjId: null, healthColStyle: "stoplight",
    settings: { defaultSplit: 60, snapDefault: true, holidays: {}, customHealth: [], healthLabelOverrides: {} },
    projects: {
      1: { id: 1, name: "Master Schedule", tasks: [
        task(1, "Task Alpha (parent)", "2026-01-05", "2026-01-16", 10),
        task(2, "Task Beta (child)", "2026-01-12", "2026-01-16", 5, { parentId: 1 }),
        task(3, "Task Gamma", "2026-01-19", "2026-01-23", 5),
      ] },
    },
    __rev: 1,
  };
}

async function newPage(browser, backend) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await assertMeasurable(page, "verify-merge-toast");
  const consoleErrs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/WebSocket|realtime/i.test(m.text())) consoleErrs.push(m.text()); });
  page.on("pageerror", (e) => consoleErrs.push("pageerror: " + e.message));
  await page.route("**cdn.jsdelivr.net/npm/@supabase/supabase-js@2**", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: supaJs }));
  await page.route("**cdn.jsdelivr.net/npm/@tabler/icons-webfont**", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.route(`${SUPABASE_HOST}/**`, backend.handle);
  return { page, consoleErrs };
}

async function editTaskName(page, taskId, newName) {
  const cell = page.locator(`[data-task-row="${taskId}"] [data-col-key="name"]`).first();
  await cell.dblclick();
  await page.waitForTimeout(150);
  await page.keyboard.press("Control+A");
  await page.keyboard.type(newName);
  await page.keyboard.press("Enter");
}
async function waitForUpsertCount(backend, n, timeoutMs = 8000) {
  const start = Date.now();
  while (backend.upserts.length < n) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${n} upsert(s), got ${backend.upserts.length}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function readToast(page) {
  return page.locator('[data-testid="schedule-toast"]').first().innerText().catch(() => null);
}
async function bannerVisible(page) {
  return page.getByText("A newer version was saved elsewhere.").isVisible().catch(() => false);
}

// ── Cases 1/3/4: establish an ancestor, inject a foreign row, edit again, read the toast ─────
async function runInjectedMergeCase(browser, label, mutateForeign, assertFn) {
  console.log(`\n${label}`);
  const backend = makeBackend();
  backend.setForeignRow("hs-v1", seedDoc());
  const { page, consoleErrs } = await newPage(browser, backend);
  try {
    await page.goto(new URL("sequence/", BASE).href, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector("[data-task-row]", { timeout: 20000 });
    await page.waitForTimeout(500);

    // Local edit #1 — establishes a NORMALIZED ancestor (the raw hand-seeded doc always differs
    // from the in-memory normalized `data` on this tab's first-ever save; without this step every
    // case would be confounded by that first-save noise rather than testing the merge itself).
    await editTaskName(page, 1, "Task Alpha");
    await waitForUpsertCount(backend, 1);
    const ancestor = JSON.parse(JSON.stringify(backend.rows["hs-v1"].value));

    // Inject the foreign revision — directly on the mock's stored row, no second tab.
    const foreign = JSON.parse(JSON.stringify(ancestor));
    mutateForeign(foreign);
    foreign.__rev = ancestor.__rev + 1;
    backend.setForeignRow("hs-v1", foreign);

    // Local edit #2 — this tab's own save discovers the injected foreign rev and merges for real.
    await editTaskName(page, 2, "Task Beta (local)");
    await waitForUpsertCount(backend, 2);
    await page.waitForTimeout(400);

    const toast = await readToast(page);
    const banner = await bannerVisible(page);
    await assertFn({ toast, banner, backend, consoleErrs });
  } finally {
    await page.close();
  }
}

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

  // ── Case 1 — one field changed in one (different) schedule ─────────────────────────────────
  await runInjectedMergeCase(browser, "Case 1 — one field changed in one schedule", (foreign) => {
    foreign.projects["2"].tasks[0].name = "Kickoff (updated remotely)";
  }, async ({ toast, banner, backend, consoleErrs }) => {
    check("toast fired", !!toast, JSON.stringify(toast));
    check("toast reports exactly 1 task", /\b1 task\b/.test(toast || ""), toast || "");
    check("toast names the actually-changed schedule (Grand Port)", /Grand Port/.test(toast || ""), toast || "");
    check("no stale/false-conflict banner alongside the toast", !banner);
    check("no console/page errors", consoleErrs.length === 0, consoleErrs.slice(0, 3).join(" | "));
    const evt = backend.clientErrors.find((r) => r && r.source === "event:merge-toast");
    check("telemetry: a client_errors event:merge-toast row was recorded", !!evt, JSON.stringify(evt));
    check("telemetry: row is tagged module=scheduler", evt && evt.module === "scheduler");
    check("telemetry: row's message carries the count + schedule name", evt && /1 task/.test(evt.message) && /Grand Port/.test(evt.message), evt && evt.message);
  });

  // ── Case 2 — a row inserted mid-schedule: count is 1, never "every row below the insert" ─────
  console.log("\nCase 2 — a row inserted mid-schedule (id-churn immunity)");
  {
    const backend = makeBackend();
    backend.setForeignRow("hs-v1", seedDoc());
    const { page, consoleErrs } = await newPage(browser, backend);
    try {
      await page.goto(new URL("sequence/", BASE).href, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForSelector("[data-task-row]", { timeout: 20000 });
      await page.waitForTimeout(500);
      await editTaskName(page, 1, "Task Alpha");
      await waitForUpsertCount(backend, 1);
      const ancestor = JSON.parse(JSON.stringify(backend.rows["hs-v1"].value));

      // A real structural insert renumbers every task's `id` by array position (renumberTasks'
      // own documented behavior) while each task's permanent `_sid` stays put — exactly what a
      // real "insert row" on another device would produce.
      const foreign = JSON.parse(JSON.stringify(ancestor));
      const p1 = foreign.projects["1"];
      const inserted = task(2, "Task Inserted", "2026-01-10", "2026-01-10", 1, { _sid: "new:inserted-1" });
      const shiftedB = { ...p1.tasks[1], id: 3 };
      const shiftedC = { ...p1.tasks[2], id: 4 };
      p1.tasks = [p1.tasks[0], inserted, shiftedB, shiftedC];
      foreign.__rev = ancestor.__rev + 1;
      backend.setForeignRow("hs-v1", foreign);

      await editTaskName(page, 1, "Task Alpha (local)");
      await waitForUpsertCount(backend, 2);
      await page.waitForTimeout(400);
      const toast = await readToast(page);
      const banner = await bannerVisible(page);
      check("toast fired", !!toast, JSON.stringify(toast));
      check("count is the real ADD only (1) — not every row the insert shifted (3)", /\b1 task\b/.test(toast || ""), toast || "");
      check("no stale/false-conflict banner", !banner);
      check("no console/page errors", consoleErrs.length === 0, consoleErrs.slice(0, 3).join(" | "));
      const finalTasks = backend.rows["hs-v1"].value.projects["1"].tasks;
      check("all 4 tasks survive the merge (no dropped/duplicated row)", finalTasks.length === 4, `len=${finalTasks.length}`);
      const evt = backend.clientErrors.find((r) => r && r.source === "event:merge-toast");
      check("telemetry: recorded with count 1", evt && /1 task/.test(evt.message), evt && evt.message);
    } finally {
      await page.close();
    }
  }

  // ── Case 3 — a project added ────────────────────────────────────────────────────────────────
  await runInjectedMergeCase(browser, "Case 3 — a project added", (foreign) => {
    foreign.projects["3"] = { id: 3, name: "Newly Added Schedule", tasks: [
      task(1, "New Kickoff", "2026-02-01", "2026-02-01", 1),
    ] };
  }, async ({ toast, banner, backend, consoleErrs }) => {
    check("toast fired", !!toast, JSON.stringify(toast));
    check("toast reports exactly 1 task", /\b1 task\b/.test(toast || ""), toast || "");
    check("toast names the new schedule", /Newly Added Schedule/.test(toast || ""), toast || "");
    check("the new project actually landed in the merged doc", !!backend.rows["hs-v1"].value.projects["3"]);
    check("no stale/false-conflict banner", !banner);
    check("no console/page errors", consoleErrs.length === 0, consoleErrs.slice(0, 3).join(" | "));
  });

  // ── Case 4 — a project removed ──────────────────────────────────────────────────────────────
  await runInjectedMergeCase(browser, "Case 4 — a project removed", (foreign) => {
    delete foreign.projects["2"];
  }, async ({ toast, banner, backend, consoleErrs }) => {
    check("toast fired", !!toast, JSON.stringify(toast));
    check("toast reports exactly 1 task", /\b1 task\b/.test(toast || ""), toast || "");
    check("the removed project actually stays gone after the merge", !backend.rows["hs-v1"].value.projects["2"]);
    check("no stale/false-conflict banner", !banner);
    check("no console/page errors", consoleErrs.length === 0, consoleErrs.slice(0, 3).join(" | "));
  });

  // ── Case 5 — a view-only change alone (task.focused): no toast, no cloud write at all ────────
  console.log("\nCase 5 — a view-only change alone (task.focused)");
  {
    const backend = makeBackend();
    backend.setForeignRow("hs-v1", seedDocWithParentChild());
    const { page, consoleErrs } = await newPage(browser, backend);
    try {
      await page.goto(new URL("sequence/", BASE).href, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForSelector("[data-task-row]", { timeout: 20000 });
      await page.waitForTimeout(500);

      const focusToggle = page.locator('[data-task-row="1"] [title^="Focus:"]');
      check("fixture reaches the reported precondition (a Focus toggle exists on the parent row)", (await focusToggle.count()) > 0);

      // Establish a normalized ancestor first — same reasoning as the injected-merge cases.
      await editTaskName(page, 3, "Task Gamma");
      await waitForUpsertCount(backend, 1);
      const upsertsBeforeToggle = backend.upserts.length;

      await focusToggle.first().click();
      await page.waitForTimeout(2500); // generous — a spurious save would land well within this
      const toastAfterToggle = await page.locator('[data-testid="schedule-toast"]').first().isVisible().catch(() => false);

      check("no cloud write from toggling a view-only field alone", backend.upserts.length === upsertsBeforeToggle, `upserts=${backend.upserts.length}`);
      check("no toast from a view-only change", !toastAfterToggle);
      check("no console/page errors", consoleErrs.length === 0, consoleErrs.slice(0, 3).join(" | "));
    } finally {
      await page.close();
    }
  }

  await browser.close();
}

await run();

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
