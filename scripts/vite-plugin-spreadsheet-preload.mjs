/* Vite plugin — start downloading the Spreadsheet's code at t=0 when the page is opening ON the Spreadsheet (NEW-1, B2604xxx;
 * docs/SPREADSHEET-UNIVER-SPIKE.md "Load time").
 *
 * WHY. A cold open of the Spreadsheet is a three-hop chain: the entry bundle runs, the shell reads the route, THEN it asks for the Model
 * workspace chunk, and only when that runs does it ask for the Univer grid (several MB). Each hop waits for the previous one to finish, so
 * on a real connection the 2 MB-compressed grid starts downloading a full round trip or three late. The browser cannot know the route
 * before JavaScript runs — but the URL is readable by a tiny inline script in index.html, before the entry bundle even arrives.
 *
 * WHAT IT DOES. At build time it finds the Model workspace chunk and the Univer grid chunk (and every chunk those import statically),
 * and writes ONE inline script into index.html. At page start the script checks two cheap facts and, only if one is true, adds
 * <link rel="modulepreload"> tags for exactly those files (fetch + compile off the main thread; nothing runs early):
 *   · the URL's route is the Spreadsheet (a `spreadsheet` / legacy `model` segment), or
 *   · the URL is EMPTY (a fresh tab) and the stored "where I left off" pointer (planyr:lastRoute:v1, src/app/lastRoute.js) names the
 *     Model module — the shell is about to seed exactly that route.
 * Every other route pays nothing: no tag, no byte, no request. The script reads localStorage inside try/catch and never throws.
 *
 * LOUD-FAILURE: if the build cannot find those chunks the BUILD FAILS naming this file (a silent skip would quietly turn the preload
 * off and nothing else would notice). The inline script only ever ADDS tags — a wrong guess costs bandwidth, never behaviour. */
const MODEL_SRC = /src\/workspaces\/model\/ModelApp\.jsx$/;
const GRID_SRC = /src\/workspaces\/model\/components\/UniverSheet\.jsx$/;
export const LAST_ROUTE_KEY = "planyr:lastRoute:v1";

/** The files to preload: the Model chunk, the grid chunk, and their STATIC import closure (dynamic imports are left to load on demand). */
export function spreadsheetChunkSet(bundle) {
  const byFile = new Map(); for (const [name, c] of Object.entries(bundle)) if (c.type === "chunk") byFile.set(name, c);
  const roots = [...byFile.values()].filter((c) => c.facadeModuleId && (MODEL_SRC.test(c.facadeModuleId.replace(/\\/g, "/")) || GRID_SRC.test(c.facadeModuleId.replace(/\\/g, "/"))));
  const hasModel = roots.some((c) => MODEL_SRC.test(c.facadeModuleId.replace(/\\/g, "/")));
  const hasGrid = roots.some((c) => GRID_SRC.test(c.facadeModuleId.replace(/\\/g, "/")));
  if (!hasModel || !hasGrid) throw new Error(`vite-plugin-spreadsheet-preload: could not find the ${!hasModel ? "Model workspace" : "Univer grid"} chunk in the build — the preload would silently turn off; fix scripts/vite-plugin-spreadsheet-preload.mjs`);
  const out = new Set();
  const walk = (c) => { if (out.has(c.fileName)) return; out.add(c.fileName); for (const i of c.imports || []) { const n = byFile.get(i); if (n) walk(n); } };
  roots.forEach(walk);
  return [...out];
}

/** The inline script text for a given file list and public base (pure — unit-tested). */
export function preloadScript(files, base = "/") {
  const b = base.endsWith("/") ? base : base + "/";
  const list = JSON.stringify(files.map((f) => b + f));
  return `(function(){try{var h=location.hash||"",go=/(^|\\/)(spreadsheet|model)(\\/|\\?|$)/.test(h);`
    + `if(!go&&(h===""||h==="#")){var p=JSON.parse(localStorage.getItem(${JSON.stringify(LAST_ROUTE_KEY)})||"null");go=!!p&&p.module==="model"}`
    + `if(!go)return;var f=${list},d=document;for(var i=0;i<f.length;i++){var l=d.createElement("link");l.rel="modulepreload";l.href=f[i];d.head.appendChild(l)}}catch(e){}})();`;
}

/** True only for the app's own root index.html (pure — unit-tested). */
export function isAppPage(ctx) {
  const p = String((ctx && (ctx.path || ctx.filename)) || "").replace(/\\/g, "/");
  return p === "/index.html" || /(^|\/)planyr\/index\.html$/.test(p) || p === "index.html";
}

export default function spreadsheetPreload() {
  let base = "/";
  return {
    name: "planyr-spreadsheet-preload",
    apply: "build",
    configResolved(cfg) { base = cfg.base || "/"; },
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (!ctx || !ctx.bundle) return html;
        // only the main app page: a build with another entry (the ui-audit harness builds, the standalone landing / legal pages) has no Model chunk
        // to find, and that is not a failure — but the real index.html below still throws if its chunks are missing (LOUD-FAILURE)
        if (!isAppPage(ctx)) return html;
        const files = spreadsheetChunkSet(ctx.bundle);
        return { html, tags: [{ tag: "script", children: preloadScript(files, base), injectTo: "head-prepend" }] };
      },
    },
  };
}
