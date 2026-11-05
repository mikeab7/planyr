/* React binding for the pure captcha gate (NEW-1) — one gate per form, a stable object across
 * renders. `runRef.current` is the form's CURRENT submit (it reads the latest field values when it
 * finally fires, which may be after the token arrives, not when the person tapped). `widgetKey`
 * remounts the widget for "Try again". The gate is never destroyed on unmount (StrictMode re-runs
 * effects); a `mounted` guard keeps late callbacks from touching an unmounted component. */
import { useEffect, useReducer, useRef, useState } from "react";
import { createCaptchaGate } from "./captchaGate.js";

export function useCaptchaGate(run) {
  const [, bump] = useReducer((n) => n + 1, 0);
  const [widgetKey, setWidgetKey] = useState(0);
  const mounted = useRef(true);
  const runRef = useRef(run);
  runRef.current = run;
  const widgetRef = useRef(null);
  const gateRef = useRef(null);
  if (!gateRef.current) {
    gateRef.current = createCaptchaGate({
      run: (token) => runRef.current(token),
      reset: () => widgetRef.current?.reset(),
      remount: () => setWidgetKey((k) => k + 1),
      onChange: () => { if (mounted.current) bump(); },
    });
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; gateRef.current.cancel(); }; }, []);
  const gate = gateRef.current;
  return { gate, view: gate.view(), widgetKey, widgetRef };
}
