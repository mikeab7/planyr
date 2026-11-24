// Harness compatibility for the Schedule page.
//
// Until audit batch J3 the page was ONE classic <script>, so every top-level function was a property of `window`
// and every top-level const/let/class a global lexical binding: the ui-audit and e2e drivers call them by bare name
// from page.evaluate (mount GanttView, call buildGanttSVG, read COLS or HEALTH, fire showToast …). The page is ES
// modules now, whose bindings are private, so each module publishes the bindings it declares here, once, at load.
//
//   exposeToHarness({ name: [getter, setter?] })
//
// A getter keeps the binding LIVE (a `let` that changes — ROW_H, HEALTH — reads its current value, not a copy taken
// at load); a setter is given only to a binding the module itself reassigns. A name the browser (or the engine's own
// published globals) already owns is left alone.
export function exposeToHarness(table) {
  for (const [name, [get, set]] of Object.entries(table)) {
    if (name in globalThis) continue;
    Object.defineProperty(globalThis, name, { get, set, configurable: true, enumerable: false });
  }
}
