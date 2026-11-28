/* PasswordInput — the ONE password field (NEW-2, 2026-11-28: "a feature where you can actually see the password that
 * you're typing"). Every password box in the app (sign in, sign up, set a new password, change password, invite
 * sign-up) renders this, so the eye toggle is identical everywhere.
 *
 * It is the SAME <input> element the whole time — only its `type` flips between "password" and "text" — so the caret,
 * the typed value and autofill / password-manager hooks (name, autoComplete, the element identity) are untouched.
 * The eye button is a real <button type="button"> after the input (reachable by Tab, Space/Enter toggle) with
 * aria-label + aria-pressed; its mousedown is swallowed so pressing it never steals focus or moves the caret out of
 * the input. Colours are tokens only (readable in both themes). Resets to hidden when the field unmounts. */
import { forwardRef, useState } from "react";

const EyeIcon = ({ off }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M3 3l18 18" />}
  </svg>
);

const PasswordInput = forwardRef(function PasswordInput({ style, wrapperStyle, ...rest }, ref) {
  const [shown, setShown] = useState(false);
  // The field's outer margin moves to the wrapper so the eye centres on the box itself, not on its margin.
  const { marginTop, marginBottom, ...inputStyle } = style || {};
  return (
    <div style={{ position: "relative", marginTop, marginBottom, ...wrapperStyle }}>
      <input ref={ref} {...rest} type={shown ? "text" : "password"} style={{ ...inputStyle, paddingRight: 40 }}
        // A shown password is plain text: tell spellcheck / capitalisation helpers to leave it alone.
        {...(shown ? { autoCapitalize: "none", autoCorrect: "off", spellCheck: false } : {})} />
      <button type="button" data-testid="password-toggle" className="tap-target"
        aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}
        onMouseDown={(e) => e.preventDefault()} onClick={() => setShown((v) => !v)}
        style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, padding: 0, border: "none", background: "transparent",
          color: "var(--text-secondary)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6 }}>
        <EyeIcon off={shown} />
      </button>
    </div>
  );
});

export default PasswordInput;
