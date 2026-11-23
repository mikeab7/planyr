/* notesControls — the ONE Notes-side mirror of the shared control radius scale (audit Batch I8).
 * Mirrored by value from `shared/ui/controls.jsx` `CONTROL_RADIUS` (control / pill). Notes must not
 * import controls.jsx (that hoists another shared chunk onto the Site route), so the literal lives
 * here ONCE instead of in 14 components; `test/notesModule.test.js` fails if it drifts from the source.
 * Edit the digits only together with controls.jsx. */
export const RADIUS = { control: 8, pill: 999 };
