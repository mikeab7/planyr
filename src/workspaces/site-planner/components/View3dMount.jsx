/* View3dMount — the planner-side door to the 3D grading viewer (owner-only; NEW-1, 2026-11-11). Small and three.js-free: it is the only part of the
 * feature that rides the planner chunk besides the Grading panel's button. It does three jobs the lazy viewer cannot do for itself:
 *
 *  1. A FALLBACK that is already the black void ("Opening the 3D view…") while the viewer's chunk (three.js) downloads — the first open on a slow link
 *     shows the screen change at once instead of a button that seems dead.
 *  2. A BOUNDARY for the chunk failing to load (a build was published while the tab was open) or the viewer throwing: it says so, on the same black, with
 *     Close — and Reload when the code is simply gone. Never a blank screen, never the whole planner taken down (LOUD-FAILURE).
 *  3. A SEAL on React's synthetic events. The viewer is portalled to <body>, but React bubbles events through the React tree, so a press, wheel or key
 *     inside it would otherwise reach the planner's own handlers (a drag would pan the plan behind it). Every pointer / mouse / touch / wheel / key event
 *     stops here. (The viewer also swallows keys natively, in the capture phase, for the planner's window-level shortcuts.)
 * Module scope throughout (MODULE-SCOPE-COMPONENTS). */
import React, { Component, Suspense } from "react";
import { isChunkLoadError, reloadFresh } from "../../../app/chunkReload.js";
import { reportClientError } from "../../../shared/telemetry/clientErrors.js";
import { FloatingToolbar, FloatingToolButton, FloatingToolLabel } from "../../../shared/ui/controls.jsx";
import { VOID_HEX } from "../lib/grading3d/colors.js";
import { SPACE } from "../../../shared/ui/designTokens.js";

const stop = (e) => e.stopPropagation();
const SEAL = {
  onPointerDown: stop, onPointerMove: stop, onPointerUp: stop, onMouseDown: stop, onMouseUp: stop, onClick: stop, onDoubleClick: stop,
  onContextMenu: stop, onWheel: stop, onKeyDown: stop, onKeyUp: stop, onTouchStart: stop, onTouchMove: stop, onTouchEnd: stop,
};
const Screen = ({ children }) => (
  <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: VOID_HEX, display: "grid", placeItems: "center" }}>{children}</div>
);

class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { reportClientError(error, { where: "grading-3d-viewer", componentStack: info && info.componentStack }); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkLoadError(error);
    return (
      <Screen>
        <FloatingToolbar style={{ gap: SPACE.md, padding: SPACE.md }}>
          <FloatingToolLabel>{stale ? "A newer version of Planyr was published, so the 3D view's code is gone." : "Couldn't open the 3D view."}</FloatingToolLabel>
          {stale && <FloatingToolButton onClick={() => reloadFresh()}>Reload</FloatingToolButton>}
          <FloatingToolButton data-testid="grading-3d-error-close" onClick={this.props.onClose}>Close</FloatingToolButton>
        </FloatingToolbar>
      </Screen>
    );
  }
}

export default function View3dMount({ onClose, children }) {
  return (
    <div style={{ display: "contents" }} {...SEAL}>
      <Boundary onClose={onClose}>
        <Suspense fallback={<Screen><FloatingToolbar><FloatingToolLabel data-testid="grading-3d-opening">Opening the 3D view…</FloatingToolLabel></FloatingToolbar></Screen>}>
          {children}
        </Suspense>
      </Boundary>
    </div>
  );
}
