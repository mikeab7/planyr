import { exposeToHarness } from "../harnessGlobals.js";
 // local "today"; refreshed live by App (focus / midnight rollover)

// ── In-app confirm (audit batch J3) ───────────────────────
// Replaces window.confirm: a themed dialog that matches the page (light + dark through the --bg/--txt tokens), answers with a
// Promise<boolean>. Enter = confirm, Escape / backdrop / Cancel = no. One at a time; a second call cancels the first.
export const askConfirm = (() => {
  let _open = null;
  return ({ title, body = "", confirmLabel = "Continue", danger = false } = {}) => new Promise((resolve) => {
    if (_open) _open(false);
    const prevFocus = document.activeElement;
    const back = document.createElement("div");
    back.setAttribute("data-testid", "schedule-confirm");
    Object.assign(back.style, { position: "fixed", inset: "0", background: "rgba(0,0,0,.45)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
    const card = document.createElement("div");
    card.setAttribute("role", "alertdialog"); card.setAttribute("aria-modal", "true");
    Object.assign(card.style, { background: "var(--bg)", color: "var(--txt)", border: "1px solid var(--bd2)", borderRadius: "10px", boxShadow: "0 12px 40px rgba(0,0,0,.35)", width: "min(440px, 100%)", padding: "18px 20px 14px", fontFamily: "'Inter', system-ui, sans-serif" });
    const h = document.createElement("div");
    h.textContent = title || "Are you sure?";
    Object.assign(h.style, { fontSize: "14px", fontWeight: "600", marginBottom: body ? "8px" : "14px", lineHeight: "1.4" });
    card.appendChild(h);
    if (body) {
      const b = document.createElement("div");
      b.textContent = body;
      Object.assign(b.style, { fontSize: "12.5px", color: "var(--mut)", lineHeight: "1.55", whiteSpace: "pre-wrap", marginBottom: "16px" });
      card.appendChild(b);
    }
    const row = document.createElement("div");
    Object.assign(row.style, { display: "flex", justifyContent: "flex-end", gap: "8px" });
    const mk = (label, primary) => {
      const x = document.createElement("button");
      x.type = "button"; x.textContent = label;
      Object.assign(x.style, { font: "inherit", fontSize: "12.5px", fontWeight: "600", padding: "7px 14px", borderRadius: "7px", cursor: "pointer",
        border: primary ? "1px solid transparent" : "1px solid var(--bd2)",
        background: primary ? (danger ? "#b42318" : "var(--amber)") : "var(--surf)",
        color: primary ? (danger || document.documentElement.dataset.theme !== "dark" ? "#fff" : "#14171C") : "var(--txt)" });
      return x;
    };
    const no = mk("Cancel", false), yes = mk(confirmLabel, true);
    row.appendChild(no); row.appendChild(yes); card.appendChild(row); back.appendChild(card);
    let done = false;
    const finish = (v) => {
      if (done) return; done = true; _open = null;
      document.removeEventListener("keydown", onKey, true); back.remove();
      try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch {}
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); finish(document.activeElement === no ? false : true); }
      else if (e.key === "Tab") { e.preventDefault(); (document.activeElement === yes ? no : yes).focus(); }
    };
    _open = finish;
    no.onclick = () => finish(false); yes.onclick = () => finish(true);
    back.addEventListener("mousedown", (e) => { if (e.target === back) finish(false); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(back);
    (danger ? no : yes).focus();
  });
})();

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  askConfirm: [() => askConfirm],
});
