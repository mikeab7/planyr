/* Model workspace — the two tiny prompts the Excel keys need on the Univer grid: Excel's Insert / Delete "shift cells"
 * radio dialog, and a one-number prompt (Column width / Row height). Plain DOM, appended inside the grid's own host so the
 * theme tokens apply and focus returns to the sheet when it closes; no React, no Univer import.
 *
 * Keyboard (Excel's): arrows move between the choices, a choice's underlined letter picks it, Enter = OK, Esc = Cancel.
 * Each resolves to the chosen value, or `null` when cancelled — the caller changes nothing on `null`. */
import { RADIUS } from "../../../../shared/ui/radius.js";

const el = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style") Object.assign(n.style, v);
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  children.forEach((c) => n.appendChild(c));
  return n;
};

const BOX = {
  position: "absolute", left: "50%", top: "30%", transform: "translateX(-50%)", zIndex: 1000, minWidth: "260px", maxWidth: "calc(100% - 32px)",
  padding: "14px 16px", background: "var(--surface-raised)", color: "var(--text-primary)", border: "1px solid var(--border-strong)",
  borderRadius: RADIUS.md, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", font: "inherit", fontSize: "13px", lineHeight: "1.4",
};
const BTN = { padding: "4px 14px", marginLeft: "8px", font: "inherit", cursor: "pointer", border: "1px solid var(--border-strong)", borderRadius: RADIUS.sm, background: "var(--surface-raised)", color: "var(--text-primary)" };

/** Shared shell: builds the box, owns Esc/Enter, and restores focus to whatever had it. */
function open(host, { title, testid, body, focusEl, onOk, onKey: extraKey }) {
  const prev = document.activeElement;
  return new Promise((resolve) => {
    const ok = el("button", { type: "button", "data-testid": `${testid}-ok`, text: "OK" }); Object.assign(ok.style, BTN, { background: "var(--accent)", color: "var(--on-accent)", borderColor: "var(--accent)" });
    const cancel = el("button", { type: "button", "data-testid": `${testid}-cancel`, text: "Cancel" }); Object.assign(cancel.style, BTN);
    const box = el("div", { role: "dialog", "aria-modal": "true", "aria-label": title, "data-testid": testid, style: BOX }, [
      el("div", { text: title, style: { fontWeight: "700", marginBottom: "10px" } }), body,
      el("div", { style: { display: "flex", justifyContent: "flex-end", marginTop: "14px" } }, [cancel, ok]),
    ]);
    let done = false;
    const finish = (value) => {
      if (done) return; done = true;
      box.removeEventListener("keydown", onKey, true); box.remove();
      try { prev && prev.focus && prev.focus(); } catch (_) { /* the grid takes focus on the next key */ }
      resolve(value);
    };
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); return; }
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); const v = onOk(); if (v !== undefined) finish(v); return; }
      if (extraKey && extraKey(e)) { e.preventDefault(); e.stopPropagation(); return; }
      e.stopPropagation();                                  // the grid must never see a key typed into the prompt
    }
    box.addEventListener("keydown", onKey, true);
    // the host's own pointer handling must not treat a click in the prompt as a click on the sheet
    box.addEventListener("mousedown", (e) => e.stopPropagation());
    ok.addEventListener("click", () => { const v = onOk(); if (v !== undefined) finish(v); });
    cancel.addEventListener("click", () => finish(null));
    host.appendChild(box);
    (focusEl || ok).focus();
  });
}

/** Excel's Insert / Delete prompt. `choices` = [{ value, label, key }]; resolves to the chosen `value` or null. */
export function promptChoice(host, { title, choices, initial }) {
  const name = `planyr-choice-${Math.random().toString(36).slice(2, 8)}`;
  const inputs = choices.map((c) => el("input", { type: "radio", name, value: c.value, "data-testid": `excel-keys-choice-${c.value}` }));
  const first = inputs.find((i) => i.value === (initial || choices[0].value)) || inputs[0];
  first.checked = true;
  const rows = choices.map((c, i) => {
    const label = el("label", { style: { display: "flex", alignItems: "center", gap: "8px", padding: "3px 0", cursor: "pointer" } }, [inputs[i], el("span", { text: c.label })]);
    return label;
  });
  const body = el("div", {}, rows);
  // a choice's accelerator letter picks it (Excel underlines it); handled by the shell's key handler, which sits above `body`
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const hit = choices.findIndex((c) => c.key === String(e.key).toLowerCase());
    if (hit < 0) return false;
    inputs[hit].checked = true; inputs[hit].focus();
    return true;
  };
  return open(host, { title, testid: "excel-keys-choice-dialog", body, focusEl: first, onOk: () => (inputs.find((i) => i.checked) || first).value, onKey });
}

/** A one-number prompt. Resolves to a positive finite number, or null. */
export function promptNumber(host, { title, label, value }) {
  const input = el("input", { type: "number", min: "1", step: "any", value: String(value ?? ""), "data-testid": "excel-keys-number-input", "aria-label": label });
  Object.assign(input.style, { width: "100%", boxSizing: "border-box", padding: "4px 6px", font: "inherit", border: "1px solid var(--border-strong)", borderRadius: RADIUS.sm, background: "var(--surface-page)", color: "var(--text-primary)" });
  const body = el("label", { style: { display: "block" } }, [el("div", { text: label, style: { marginBottom: "4px" } }), input]);
  const p = open(host, {
    title, testid: "excel-keys-number-dialog", body, focusEl: input,
    onOk: () => { const n = Number(input.value); return Number.isFinite(n) && n > 0 ? n : undefined; },
  });
  input.select();
  return p;
}
