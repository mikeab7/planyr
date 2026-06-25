/* Headless harness for B463 — the shared RotationStepper that retires the rotation slider.
 * Mounts the REAL component (controlled, exactly as a host wires it) so
 * verify-b463-rotation-stepper.mjs can prove, logged-out / no auth:
 *   • it renders a numeric input + ▲▼ spinners and NO <input type=range> slider anywhere;
 *   • typing wraps/normalizes on commit (370 → 10, −5 → 355);
 *   • a spinner click nudges ±1° about the stored value;
 *   • garbage input flashes invalid + reverts (never clamps to 0);
 *   • empty input on blur reverts to the last committed value;
 *   • a locked instance disables the input AND the spinners (refuses, with a reason).
 * Served by `npm run dev`. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import RotationStepper, { normalizeDeg } from "../src/shared/ui/RotationStepper.jsx";

function Controlled({ scope, locked }) {
  const [v, setV] = useState(45);
  return (
    <div data-scope={scope} style={{ padding: 16, fontFamily: "system-ui" }}>
      <RotationStepper
        value={v}
        disabled={locked}
        disabledReason="Unlock to rotate"
        onCommit={(deg) => setV(deg)}
        onStep={(d) => setV((cur) => normalizeDeg(cur + d))}
        data-testid={`stepper-${scope}`}
      />
      <span data-value={scope} style={{ marginLeft: 12, fontFamily: "ui-monospace, monospace" }}>{v}</span>
    </div>
  );
}

function App() {
  return (
    <div>
      <Controlled scope="normal" locked={false} />
      <Controlled scope="locked" locked={true} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
