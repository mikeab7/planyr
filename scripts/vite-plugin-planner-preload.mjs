/* Vite plugin — start downloading the PLAN EDITOR's code at t=0 when the page is opening ON a plan (B329408, owner decision 2026-11-09).
 *
 * WHY. The plan editor (SitePlanner.jsx and everything only it reaches) is its own chunk now, so the Site route's landing map no longer waits
 * for ~1.7 MB it may never use. A page that opens straight onto a plan (a pasted link, a reload — the usual way in) DOES need it at once, and
 * without help would find out only after the entry bundle ran, the shell read the route and SitePlannerApp asked for it: one extra serial
 * round trip. The URL is readable by a tiny inline script in index.html before any bundle arrives, so — exactly like the Spreadsheet's
 * preload (scripts/vite-plugin-spreadsheet-preload.mjs, whose helpers this reuses) — it adds <link rel="modulepreload"> for the editor
 * chunk and its static closure, and only when the page is opening on a plan:
 *   · the URL's route is a project on the Site module (`#/project/<id>/site`), or
 *   · the URL is EMPTY (a fresh tab) and the stored "where I left off" pointer (planyr:lastRoute:v1) names the Site module WITH a project —
 *     the shell is about to seed exactly that route.
 * Every other route (the map, the dashboard, every other workspace) pays nothing. The script reads localStorage inside try/catch and never
 * throws. LOUD-FAILURE: if the build cannot find the editor chunk the BUILD FAILS naming this file — a silent skip would quietly turn the
 * preload off. The script only ever ADDS tags: a wrong guess costs bandwidth, never behaviour. */
import { isAppPage, LAST_ROUTE_KEY } from "./vite-plugin-spreadsheet-preload.mjs";

const PLANNER_SRC = /src\/workspaces\/site-planner\/SitePlanner\.jsx$/;

/** The editor chunk and its STATIC import closure (dynamic imports stay on demand). Found by the module it holds, not only by its facade. */
export function plannerChunkSet(bundle) {
  const byFile = new Map(); for (const [name, c] of Object.entries(bundle)) if (c.type === "chunk") byFile.set(name, c);
  const holds = (c) => Object.keys(c.modules || {}).some((m) => PLANNER_SRC.test(m.replace(/\\/g, "/")))
    || (c.facadeModuleId && PLANNER_SRC.test(c.facadeModuleId.replace(/\\/g, "/")));
  const roots = [...byFile.values()].filter(holds);
  if (!roots.length) throw new Error("vite-plugin-planner-preload: could not find the plan editor chunk (SitePlanner.jsx) in the build — the preload would silently turn off; fix scripts/vite-plugin-planner-preload.mjs");
  const out = new Set();
  const walk = (c) => { if (out.has(c.fileName)) return; out.add(c.fileName); for (const i of c.imports || []) { const n = byFile.get(i); if (n) walk(n); } };
  roots.forEach(walk);
  return [...out];
}

/** The inline script text for a given file list and public base (pure — unit-tested). */
export function plannerPreloadScript(files, base = "/") {
  const b = base.endsWith("/") ? base : base + "/";
  const list = JSON.stringify(files.map((f) => b + f));
  return `(function(){try{var h=location.hash||"",go=/^#?\\/project\\/[^\\/?#]+\\/site(\\/|\\?|$)/.test(h);`
    + `if(!go&&(h===""||h==="#")){var p=JSON.parse(localStorage.getItem(${JSON.stringify(LAST_ROUTE_KEY)})||"null");go=!!p&&p.module==="site-planner"&&!!p.projectId}`
    + `if(!go)return;var f=${list},d=document;for(var i=0;i<f.length;i++){var l=d.createElement("link");l.rel="modulepreload";l.href=f[i];d.head.appendChild(l)}}catch(e){}})();`;
}

export default function plannerPreload() {
  let base = "/";
  return {
    name: "planyr-planner-preload",
    apply: "build",
    configResolved(cfg) { base = cfg.base || "/"; },
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (!ctx || !ctx.bundle) return html;
        if (!isAppPage(ctx)) return html;
        const files = plannerChunkSet(ctx.bundle);
        return { html, tags: [{ tag: "script", children: plannerPreloadScript(files, base), injectTo: "head-prepend" }] };
      },
    },
  };
}
