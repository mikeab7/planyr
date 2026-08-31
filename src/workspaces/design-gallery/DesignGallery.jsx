/* The `/design` gallery (NEW-4, docs/DESIGN.md) — every shared primitive, in every state, both
 * themes, side by side. Dev-facing only: NOT in the WORKSPACES registry (no header tab), reached
 * only by typing `#/design` (mirrors the `#/admin` pattern in src/app/route.js / Shell.jsx) and
 * lazy-loaded so it costs nothing on the shipped bundle until someone visits it.
 *
 * Point of the page: before drawing a new control, look here first (docs/DESIGN.md's hard rule
 * (b) — a new control is never invented at the call site). Each specimen is labeled with the
 * exact token/scale name it consumes, so a mismatch against what's actually in radius.js /
 * designTokens.js is visible at a glance, not just asserted in prose.
 *
 * The light/dark toggle here is LOCAL to this page (a `data-theme` wrapper around the gallery
 * content) — it does not touch the app's real ThemeProvider/localStorage, so visiting this page
 * can never change what the rest of the app renders in.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { Button, ToggleChip, IconButton, Field, Section, MenuItem, menuPanelStyle, RADIUS, PAD, FONT } from "../../shared/ui/controls.jsx";
import { RADIUS as RADIUS_SCALE } from "../../shared/ui/radius.js";
import { MODULE_ACCENT } from "../../shared/ui/moduleAccent.js";

/* ⛔ Deliberately NOT `import { STATUS_TOKENS } from "../../shared/ui/statusTokens.js"`, and NOT
 * `import { SPACE, FONT_SIZE, CONTROL_H } from "../../shared/ui/designTokens.js"` — this page is a
 * lazy route, and importing either module here made Rollup hoist it into a NEW shared chunk pulled
 * onto the Site route's plain load (bundle.siteRouteAllowlist went red: an unexpected
 * "statusTokens" chunk, then a "designTokens" one once that was fixed). Both modules previously had
 * exactly one consumer inside the Site route's eager graph, so they were inlined directly; adding
 * this lazy route as a SECOND consumer is what triggers Rollup to split them out. `radius.js` and
 * `moduleAccent.js` below are NOT mirrored — they're already shared by multiple eager consumers
 * (AppHeader.jsx et al.) and merged into an already-allowed chunk, so a second lazy consumer costs
 * nothing extra; measure before mirroring, don't mirror everything by reflex. Same trap as Notes
 * importing controls.jsx (see test/notesModule.test.js's header) — these are display-only preview
 * values, mirrored literally, with a guard (test/designGallery.test.js) asserting they can't
 * silently drift from the real files. */
const FONT_SIZE = { micro: 10, label: 10.5, control: 12, emphasis: 13, display: 14 }; // design-exempt: literal mirror of designTokens.js, guarded by test/designGallery.test.js
const SPACE = { xxs: 2, xs: 4, sm: 6, md: 8, lg: 10, xl: 12, xxl: 16 }; // design-exempt: literal mirror of designTokens.js, guarded by test/designGallery.test.js
const CONTROL_H = { sm: 22, md: 26, lg: 30 }; // design-exempt: literal mirror of designTokens.js, guarded by test/designGallery.test.js

const STATUS_PREVIEW = {
  pursuit:  { color: "#D85A30", glyph: "", dim: false }, // design-exempt: literal mirror of statusTokens.js, guarded by test/designGallery.test.js
  active:   { color: "#378ADD", glyph: "", dim: false }, // design-exempt: literal mirror of statusTokens.js, guarded by test/designGallery.test.js
  onhold:   { color: "#BA7517", glyph: "‖", dim: false }, // design-exempt: literal mirror of statusTokens.js, guarded by test/designGallery.test.js
  complete: { color: "#888780", glyph: "✓", dim: true }, // design-exempt: literal mirror of statusTokens.js, guarded by test/designGallery.test.js
  dead:     { color: "#888780", glyph: "✕", dim: true }, // design-exempt: literal mirror of statusTokens.js, guarded by test/designGallery.test.js
};

const MODULE_TEXT_TOKEN = {
  "site-planner": "--accent-site-text", "scheduler": "--accent-schedule-text", "doc-review": "--accent-review-text",
  "library": "--accent-library-text", "notes": "--accent-notes-text", "model": "--accent-model-text",
};
const MODULE_ON_ACCENT = {
  "site-planner": "--on-accent-site", "scheduler": "--on-accent-schedule", "doc-review": "--on-accent-review",
  "library": "--on-accent-library", "notes": "--on-accent-notes", "model": "--on-accent-model",
};

function Specimen({ label, tokens, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 40 }}>{children}</div>
      <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", lineHeight: 1.3, maxWidth: 180 }}>
        <div style={{ fontWeight: 600, color: "var(--text-secondary)" }}>{label}</div>
        {tokens && <code style={{ fontSize: 10 }}>{tokens}</code>}
      </div>
    </div>
  );
}

function Row({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 12 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 22 }}>{children}</div>
    </div>
  );
}

function ScaleTable({ title, entries }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--text-primary)" }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {entries.map(([name, value]) => (
          <div key={name} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "4px 9px", borderRadius: RADIUS.control,
            border: "1px solid var(--border-default)", background: "var(--surface-raised)", fontSize: 11.5,
          }}>
            <code style={{ color: "var(--accent-site-text)" }}>{name}</code>
            <span style={{ color: "var(--text-secondary)" }}>{String(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GalleryBody() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 28px 80px" }}>
      <h1 style={{ fontSize: FONT_SIZE.display, fontWeight: 700, marginBottom: 4, color: "var(--text-primary)" }}>Design gallery</h1>
      <p style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", marginBottom: 28, maxWidth: 640 }}>
        Every shared primitive from <code>src/shared/ui/controls.jsx</code>, in every state, in this
        theme. See <code>docs/DESIGN.md</code> for the full contract. Look here before writing a new
        control — if none of these fit, extend the primitive set, don't fork a local style.
      </p>

      <ScaleTable title="RADIUS (src/shared/ui/radius.js)" entries={Object.entries(RADIUS_SCALE)} />
      <ScaleTable title="FONT_SIZE (src/shared/ui/designTokens.js)" entries={Object.entries(FONT_SIZE)} />
      <ScaleTable title="SPACE (src/shared/ui/designTokens.js)" entries={Object.entries(SPACE)} />
      <ScaleTable title="CONTROL_H (src/shared/ui/designTokens.js)" entries={Object.entries(CONTROL_H)} />

      <Row title="Button — variant × size × state">
        {["primary", "ghost", "danger"].flatMap((variant) => ["sm", "md", "lg"].map((size) => (
          <Specimen key={`${variant}-${size}`} label={`${variant} / ${size}`} tokens={`RADIUS.control, PAD.${size}, FONT.${size === "sm" ? "sm" : "md"}`}>
            <Button variant={variant} size={size}>Label</Button>
          </Specimen>
        )))}
        <Specimen label="ghost / active (pressed toggle)" tokens="active=true"><Button variant="ghost" active>Active</Button></Specimen>
        <Specimen label="primary / disabled" tokens="disabled=true"><Button disabled>Disabled</Button></Specimen>
        <Specimen label="danger / active" tokens="variant=danger active"><Button variant="danger" active>Danger active</Button></Specimen>
        <Specimen label="focus-visible (Tab to me)" tokens="the shared global focus ring"><Button>Tab here</Button></Specimen>
      </Row>

      <Row title="ToggleChip — active × rest">
        <Specimen label="rest" tokens="RADIUS.pill"><ToggleChip>Off</ToggleChip></Specimen>
        <Specimen label="active" tokens="accent fill"><ToggleChip active>On</ToggleChip></Specimen>
      </Row>

      <Row title="IconButton — active × rest × size">
        <Specimen label="rest, 30px (default)" tokens="RADIUS.control"><IconButton>★</IconButton></Specimen>
        <Specimen label="active, 30px" tokens="accent fill"><IconButton active>★</IconButton></Specimen>
        <Specimen label="rest, 22px (size=22)" tokens="CONTROL_H.sm-scale"><IconButton size={22}>★</IconButton></Specimen>
      </Row>

      <Row title="Field — label + control row">
        <Specimen label="Field" tokens="label 12px / --text-secondary">
          <div style={{ width: 220 }}><Field label="Setback (ft)"><input style={{ width: 60 }} defaultValue="25" /></Field></div>
        </Specimen>
      </Row>

      <Row title="Section — collapsible group">
        <Specimen label={`Section (${collapsed ? "collapsed" : "open"} — click to toggle)`} tokens="RADIUS.panel">
          <div style={{ width: 260 }}>
            <Section title="Assumptions & method" collapsed={collapsed} accent="var(--accent)">
              <div style={{ fontSize: 12 }} onClick={() => setCollapsed((c) => !c)}>Body content goes here.</div>
            </Section>
          </div>
        </Specimen>
      </Row>

      <Row title="MenuItem — inside menuPanelStyle">
        <Specimen label="Menu panel (RADIUS.panel) + items (RADIUS.control)" tokens="menuPanelStyle, MenuItem">
          <div style={{ ...menuPanelStyle, width: 200 }}>
            <MenuItem>Open…</MenuItem>
            <MenuItem active>Active row</MenuItem>
            <MenuItem>Duplicate</MenuItem>
          </div>
        </Specimen>
      </Row>

      <Row title="Status tokens (src/shared/ui/statusTokens.js) — deal stage, never a module accent">
        {Object.entries(STATUS_PREVIEW).map(([key, t]) => (
          <Specimen key={key} label={key} tokens={`color ${t.color}${t.glyph ? `, glyph "${t.glyph}"` : ""}`}>
            <div aria-hidden style={{
              width: 22, height: 22, borderRadius: RADIUS.pill, background: t.color, color: "#fff", // design-exempt: white glyph on a status dot, matching statusTokens.js's own map-pin convention
              display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, opacity: t.dim ? 0.7 : 1,
            }}>{t.glyph}</div>
          </Specimen>
        ))}
      </Row>

      <Row title="Module accents (src/shared/ui/moduleAccent.js) — which workspace, never a status">
        {Object.entries(MODULE_ACCENT).map(([key, hex]) => (
          <Specimen key={key} label={key} tokens={`fill=${hex} · text var(${MODULE_TEXT_TOKEN[key]})`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
              <Button style={{ background: hex, borderColor: hex, color: `var(${MODULE_ON_ACCENT[key]})` }}>Fill</Button>
              <span style={{ color: `var(${MODULE_TEXT_TOKEN[key]})`, fontSize: 12, fontWeight: 700 }}>Text</span>
            </div>
          </Specimen>
        ))}
      </Row>
    </div>
  );
}

export default function DesignGallery({ onExit }) {
  const [mode, setMode] = useState("light");
  // PORTAL TO document.body — same reason AnchoredMenu does (see its own header): an ancestor
  // between here and <body> traps interior z-index no matter how high you set it (measured: even
  // 999999 rendered UNDER the real Site Planner's map/header, nested plainly inside Shell's own
  // `position:absolute; inset:0; zIndex:1` wrapper). Escaping to body, `position:fixed`, is the
  // proven fix this codebase already uses for exactly this failure mode.
  return createPortal(
    <div style={{ position: "fixed", inset: 0, overflow: "auto", background: "var(--surface-page)", zIndex: 999999 }} data-theme={mode} data-testid="design-gallery">
      <div style={{
        position: "sticky", top: 0, zIndex: 1, display: "flex", alignItems: "center", gap: 10,
        padding: "10px 16px", background: "var(--chrome-bg-elev)", borderBottom: "1px solid var(--chrome-divider)",
      }}>
        <strong style={{ fontSize: 13, color: "var(--chrome-text)" }}>Design gallery</strong>
        <span style={{ fontSize: 11, color: "var(--chrome-muted)" }}>(dev-only — docs/DESIGN.md)</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <ToggleChip active={mode === "light"} onClick={() => setMode("light")}>Light</ToggleChip>
          <ToggleChip active={mode === "dark"} onClick={() => setMode("dark")}>Dark</ToggleChip>
          {onExit && <Button variant="ghost" size="sm" onClick={onExit}>Exit</Button>}
        </div>
      </div>
      <GalleryBody />
    </div>,
    document.body,
  );
}
