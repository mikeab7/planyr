/* vite-plugin-recompute-probe — build-time instrumentation for the VIEW-INDEPENDENT-ONCE detector.
 *
 * ⛔ INERT UNLESS `PLANYR_PROBE=1` IS IN THE BUILD ENVIRONMENT. `npm run build` gets a plugin whose
 * only hook is its name; not one byte of probe code reaches a production bundle. Asserted by
 * test/recomputeProbe.test.js.
 *
 * WHY A BUILD-TIME TRANSFORM AND NOT A RUNTIME PATCH.
 * The obvious instrument is to monkey-patch React's dispatcher and count `useMemo` recomputes. It
 * was rejected for two reasons that matter to the verdict:
 *   1. IDENTITY. A dispatcher patch knows a factory ran; it does not know WHICH memo. Recovering
 *      that means walking a stack trace through a minified chunk, and the answer is a guess at the
 *      boundaries. Here the plugin is LOOKING AT THE SOURCE, so `file:line:name` is a literal in
 *      the emitted code — exact, and free at runtime.
 *   2. COVERAGE. Half of this defect class is not in a memo at all. The pond label fit — the second
 *      instance the owner names — is a plain function called from the render body every frame. No
 *      hook patch can see it. This instruments exported functions of the pure-library layer too,
 *      which is where that work lives.
 *
 * WHAT IT INSTRUMENTS
 *   • `useMemo(factory, deps)` anywhere under `src/` — rewritten so the factory is recorded with
 *     its DEPS as inputs and its return value as the result, and so a RENDER that reached the site
 *     is counted even when the factory did not run (`renders` vs `calls` is exactly the difference
 *     between "React re-rendered" and "the memo actually recomputed").
 *   • every exported function of the pure-computation layer (`src/workspaces/site-planner/lib/**`,
 *     `src/shared/**`) — recorded with its ARGUMENTS as inputs.
 *
 * HOW A POSITION SURVIVES THE JSX TRANSFORM. The plugin runs `enforce: "post"`, so it parses plain
 * JS rather than needing a JSX parser — but by then the line numbers are the *generated* ones.
 * `this.getCombinedSourcemap()` is the authority on where a generated position came from, and
 * `ui-audit/lib/sourceMapIndex.mjs` (written for exactly this decoding job) turns it back into a
 * real `src/…` path and line. If a map is unavailable the site is still recorded, flagged `~`, and
 * the harness prints the flag rather than quietly reporting a wrong line.
 *
 * THE EMITTED CODE TAKES NO IMPORTS. Each transformed module gets three tiny local helpers that
 * look `globalThis.__VPROBE__` up AT CALL TIME and fall through to the original call when it is
 * absent. That removes every module-initialisation-order question: a library wrapped before the
 * recorder has loaded simply runs un-recorded instead of throwing.
 */
import fs from "node:fs";
import path from "node:path";
import { makeSourceLocator } from "../ui-audit/lib/sourceMapIndex.mjs";

const RUNTIME = path.resolve(process.cwd(), "ui-audit/lib/recomputeProbeRuntime.js");

/** Files whose EXPORTED FUNCTIONS are wrapped. The pure-computation layer, deliberately: these are
 *  the modules whose answers are a function of model + settings, so a repeat with identical inputs
 *  is by definition waste. React components and the app shell are covered by the memo pass. */
const FN_SCOPES = ["src/workspaces/site-planner/lib/", "src/shared/"];

const isSrc = (id) => /\/src\//.test(id) && /\.(jsx?|mjs)$/.test(id) && !id.includes("node_modules");
const rel = (id) => {
  const i = id.replace(/\\/g, "/").lastIndexOf("/src/");
  return i >= 0 ? id.replace(/\\/g, "/").slice(i + 1) : id;
};

/* A minimal ESTree walker. Deliberately hand-rolled: the alternative is a dependency on
 * estree-walker for a fifteen-line depth-first traversal over plain objects. */
function walk(node, visit, parent = null) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit, parent); return; }
  if (typeof node.type !== "string") return;
  visit(node, parent);
  for (const k of Object.keys(node)) {
    if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
    walk(node[k], visit, node);
  }
}

/** offset → { line, column }, both ZERO-BASED, matching what a source map indexes. */
function offsetIndexer(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) starts.push(i + 1);
  return (off) => {
    let lo = 0, hi = starts.length - 1, line = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= off) { line = mid; lo = mid + 1; } else hi = mid - 1; }
    return { line, column: off - starts[line] };
  };
}

const HELPERS = `
const __VPR=(...a)=>{const P=globalThis.__VPROBE__;return P?P.run(...a):(a[1]==="memo"?a[6]():a[6].apply(a[8],a[9]));};
const __VPD=(...a)=>{const P=globalThis.__VPROBE__;if(P)P.render(...a);};
const __VPF=(i,k,f,l,c,n,t)=>{const w=function(...g){return __VPR(i,k,f,l,c,n,t,null,this,g);};try{Object.defineProperty(w,"name",{value:n});}catch{}return w;};
`;

export default function recomputeProbe({ enabled = process.env.PLANYR_PROBE === "1" } = {}) {
  if (!enabled) return { name: "recompute-probe(off)" };

  /** Every site the build instrumented, whether or not it ever runs. The standing guard needs
   *  this: a registered computation the probe never OBSERVES has to be distinguishable from one
   *  that was never instrumented, or the guard rots into a permanent green. */
  const manifest = [];

  return {
    name: "recompute-probe",
    enforce: "post",
    apply: "build",

    transform(code, id) {
      const norm = id.replace(/\\/g, "/");
      if (norm === RUNTIME.replace(/\\/g, "/")) return null;
      if (!isSrc(norm)) return null;
      /* The recorder is imported into the ENTRY rather than injected as a second <script>: an
       * import is ordered by the module graph (it initialises before anything it precedes),
       * whereas a sibling script tag is ordered by the document and would miss first render. */
      if (/\/src\/main\.jsx?$/.test(norm)) return { code: `import ${JSON.stringify(RUNTIME)};\n${code}`, map: null };
      if (!/\buseMemo\s*\(/.test(code) && !/\bexport\s+(function|const|let|var)\b/.test(code)) return null;

      let ast;
      try { ast = this.parse(code); } catch { return null; }

      // Where a generated position really came from. Never fatal — a missing map costs precision,
      // not the measurement.
      let locate = null;
      try {
        const map = this.getCombinedSourcemap();
        if (map && map.mappings) locate = makeSourceLocator(map);
      } catch { /* no map at this point in the chain */ }
      const at = offsetIndexer(code);
      const fallbackFile = rel(norm);
      const where = (off) => {
        const g = at(off);
        const hit = locate ? locate(g.line, g.column) : null;
        return hit
          ? { file: hit.source, line: hit.line, col: g.column, approx: false }
          : { file: fallbackFile, line: g.line + 1, col: g.column, approx: true };
      };

      const edits = [];      // { start, end, text }
      let n = 0;
      const wrapScope = FN_SCOPES.some((s) => fallbackFile.startsWith(s));

      walk(ast, (node) => {
        // ---- (a) useMemo(factory, deps) ----------------------------------------------------
        if (node.type === "CallExpression" && node.arguments.length === 2) {
          const c = node.callee;
          const isUseMemo =
            (c.type === "Identifier" && c.name === "useMemo") ||
            (c.type === "MemberExpression" && !c.computed && c.property?.name === "useMemo");
          if (isUseMemo && !node.arguments.some((a) => a.type === "SpreadElement")) {
            const w = where(node.start);
            const id_ = `${w.file}:${w.line}:${w.col}#memo`;
            const nm = memoName(code, node);
            manifest.push({ id: id_, kind: "memo", file: w.file, line: w.line, name: nm, approx: w.approx });
            const dv = `__vd${n++}`;
            const meta = `${JSON.stringify(id_)},"memo",${JSON.stringify(w.file)},${w.line},${w.col},${JSON.stringify(nm)}`;
            const callee = code.slice(c.start, c.end);
            const factory = code.slice(node.arguments[0].start, node.arguments[0].end);
            const deps = code.slice(node.arguments[1].start, node.arguments[1].end);
            /* The deps expression is evaluated EXACTLY ONCE, by an arrow that receives it — the
             * naive rewrite `useMemo(wrap(f, D), D)` would evaluate D twice and any dep with a
             * side effect would then be measured wrong by the instrument measuring it. */
            edits.push({
              start: node.start, end: node.end,
              text: `((${dv})=>(__VPD(${meta}),${callee}(()=>__VPR(${meta},()=>(${factory})(),${dv}),${dv})))(${deps})`,
            });
            return;
          }
        }

        // ---- (b) exported functions of the pure-computation layer ---------------------------
        if (!wrapScope || node.type !== "ExportNamedDeclaration" || !node.declaration) return;
        const d = node.declaration;
        if (d.type === "FunctionDeclaration" && d.id && !d.async && !d.generator) {
          const w = where(d.start);
          const nm = d.id.name;
          const id_ = `${w.file}:${w.line}#${nm}`;
          manifest.push({ id: id_, kind: "fn", file: w.file, line: w.line, name: nm, approx: w.approx });
          const meta = `${JSON.stringify(id_)},"fn",${JSON.stringify(w.file)},${w.line},${w.col},${JSON.stringify(nm)}`;
          /* `export function f(){}` becomes `const f = wrap(function f(){}); export { f };`.
           * The declaration loses hoisting, which only matters if the module CALLS it above its
           * own definition at module scope — vanishingly rare in this layer, and a probe-build
           * ReferenceError would be immediate and loud rather than silent. */
          edits.push({ start: node.start, end: d.start, text: `const ${nm} = __VPF(${meta},` });
          edits.push({ start: d.end, end: d.end, text: `);export{${nm}};` });
          return;
        }
        if (d.type === "VariableDeclaration") {
          for (const decl of d.declarations) {
            if (!decl.init || decl.id.type !== "Identifier") continue;
            if (decl.init.type !== "ArrowFunctionExpression" && decl.init.type !== "FunctionExpression") continue;
            if (decl.init.async || decl.init.generator) continue;
            const w = where(decl.init.start);
            const nm = decl.id.name;
            const id_ = `${w.file}:${w.line}#${nm}`;
            manifest.push({ id: id_, kind: "fn", file: w.file, line: w.line, name: nm, approx: w.approx });
            const meta = `${JSON.stringify(id_)},"fn",${JSON.stringify(w.file)},${w.line},${w.col},${JSON.stringify(nm)}`;
            edits.push({ start: decl.init.start, end: decl.init.start, text: `__VPF(${meta},` });
            edits.push({ start: decl.init.end, end: decl.init.end, text: `)` });
          }
        }
      });

      if (!edits.length) return null;
      edits.sort((a, b) => b.start - a.start || b.end - a.end);
      let out = code;
      for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
      return { code: `${HELPERS}${out}`, map: null };
    },

    generateBundle() {
      this.emitFile({ type: "asset", fileName: ".vite/probe-sites.json", source: JSON.stringify(manifest, null, 1) });
    },
  };
}

/** A readable name for a memo site: the variable it is assigned to, when there is one. */
function memoName(code, node) {
  // `const NAME = useMemo(...)` — look backwards from the call for `= ` preceded by an identifier.
  const before = code.slice(Math.max(0, node.start - 120), node.start);
  const m = /([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before);
  return m ? m[1] : "useMemo";
}
