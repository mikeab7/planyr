import RowInfo from "./RowInfo.jsx";

/* YieldFooterDisclaimer (B895) — the ONE persistent screening disclaimer for the whole
 * Yield panel, replacing the ~7 inline "screening only — confirm with your engineer /
 * reviewing authority" variants that used to repeat once per sub-card. Renders exactly
 * once (test/yieldFooterDisclaimer.test.js guards it). --text-secondary (not the more
 * muted --text-tertiary the old per-card notes used) so the one disclaimer that matters
 * stays clearly legible rather than fading — the theming rule against low-contrast body
 * text applies doubly to the line carrying the "not a substitute for an engineer" caveat. */
const TEXT = "Screening estimates for deal-stage decisions — not a substitute for a licensed engineer's design or the reviewing agency's determination.";
const DETAIL = "Every figure in this panel — detention, floodplain mitigation, buildability/FFE, road and earthwork cost, and each pond's readout — is a deal-stage screening estimate meant to move a go/no-go decision quickly. It is not a construction document. Confirm required volumes, elevations, and costs with your licensed engineer and the reviewing authority (the jurisdiction or district that approves the project) before design or permitting.";

export default function YieldFooterDisclaimer() {
  return (
    <div
      data-testid="yield-footer-disclaimer"
      style={{ display: "flex", alignItems: "flex-start", gap: 4, marginTop: 12, paddingTop: 9, borderTop: "1px solid var(--planner-border)" }}
    >
      <span style={{ fontSize: 10, color: "var(--text-secondary)", lineHeight: 1.4 }}>{TEXT}</span>
      <RowInfo label="Screening disclaimer" sections={[{ text: DETAIL }]} />
    </div>
  );
}
