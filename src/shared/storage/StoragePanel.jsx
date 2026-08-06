/* "Storage on this device" — the surface that turns a wall into a number (NEW-3/B1429).
 *
 * Reads BOTH tiers and shows them as two separate meters, never one. That separation is the whole
 * design: they have wildly different ceilings (~5 MB vs gigabytes), and conflating them is exactly
 * the mistake that mis-diagnosed the B1427 crisis — a combined "4 MB of 10 GB" reads as empty
 * while the store that matters is nearly full.
 *
 * Lazily loaded from both hosts (the account Settings tab and the signed-out ⚙ popover), so its
 * census code and its byte formatting never ride the boot bundle.
 *
 * ⛔ IMPORTS ONLY FROM `shared/` — never from a workspace. This panel is chrome on every route,
 * so a module it shares with the planner's boot path gets hoisted into a common chunk: the first
 * cut imported `gisCache` directly and put an 11.3 KB chunk on a plain Site load, breaching three
 * bundle budgets. The IndexedDB access is `originStore.js`; the map cache is cleared by NAMESPACE
 * and the live cache hears about it through a window event. Do not "tidy" either back — even a
 * 100-byte shared shim between the two tiers shows up as an unexpected Site-route chunk.
 */
import { useCallback, useEffect, useState } from "react";
import { storageSnapshot, formatBytes, LOCAL_CAP_BYTES } from "./storageCensus.js";
import { reclaimRefetchable } from "./storageReclaim.js";

const PAL = {
  ink: "var(--text-primary)", muted: "var(--text-secondary)", line: "var(--border-default)",
  accent: "var(--accent)", warn: "var(--warn-text)", danger: "var(--danger-text)", raised: "var(--surface-raised)",
};
const row = { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12, lineHeight: 1.6, color: PAL.ink };
const head = { fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: PAL.ink };
const note = { fontSize: 10.5, lineHeight: 1.5, color: PAL.muted, marginTop: 3 };

// A tier meter. `pct` drives the fill colour only — the accent below two-thirds, amber past it,
// red past 90% — so "nearly full" reads before it becomes a banner.
function Meter({ pct }) {
  const p = Math.max(0, Math.min(100, pct == null ? 0 : pct));
  const color = p >= 90 ? "var(--danger)" : p >= 66 ? "var(--warn)" : PAL.accent;
  return (
    <div style={{ height: 6, borderRadius: 3, background: "var(--surface-sunken, rgba(127,127,127,0.18))", overflow: "hidden", margin: "5px 0 2px" }}>
      <div style={{ width: `${p}%`, height: "100%", background: color, borderRadius: 3 }} />
    </div>
  );
}

function Tier({ title, subtitle, usedBytes, capBytes, pct, classes, children }) {
  return (
    <section style={{ marginTop: 14 }}>
      <div style={head}>{title}</div>
      <div style={{ ...row, marginTop: 4, fontWeight: 700 }}>
        <span>{formatBytes(usedBytes)} used</span>
        <span style={{ color: PAL.muted, fontWeight: 600 }}>{capBytes == null ? "" : `of ${formatBytes(capBytes)}`}</span>
      </div>
      <Meter pct={pct} />
      <div style={note}>{subtitle}</div>
      <div style={{ marginTop: 8 }}>
        {(classes || []).map((c) => (
          <div key={c.id} style={row}>
            <span>{c.label}{c.reclaimable ? <span style={{ color: PAL.muted }}> · re-downloads</span> : null}</span>
            <span style={{ fontVariantNumeric: "tabular-nums", color: PAL.muted }}>{formatBytes(c.bytes)}</span>
          </div>
        ))}
        {!(classes || []).length && <div style={{ ...row, color: PAL.muted }}><span>Nothing stored yet</span></div>}
      </div>
      {children}
    </section>
  );
}

export default function StoragePanel() {
  const [snap, setSnap] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try { setSnap(await storageSnapshot()); }
    catch (_) { setSnap(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const clearCache = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await reclaimRefetchable({ store: typeof localStorage !== "undefined" ? localStorage : null });
      const freed = r.freedLocalBytes + r.freedCacheBytes;
      setMsg(r.ok
        ? (freed > 0 ? `Cleared ${formatBytes(freed)} of map data. It downloads again the next time you need it.` : "There was no map data to clear.")
        : "Couldn't clear map data safely, so nothing was removed.");
      await load();
    } finally { setBusy(false); }
  };

  if (!snap) return <div style={{ ...note, marginTop: 12 }}>Checking storage…</div>;

  const localPct = snap.local.capBytes ? (snap.local.totalBytes / snap.local.capBytes) * 100 : 0;
  const idbPct = snap.idb.quotaBytes ? ((snap.idb.usageBytes || 0) / snap.idb.quotaBytes) * 100 : 0;
  const reclaimable = [...snap.local.classes, ...snap.idb.classes].filter((c) => c.reclaimable).reduce((n, c) => n + c.bytes, 0);

  return (
    <div data-testid="storage-panel">
      <div style={head}>Storage on this device</div>
      <div style={note}>
        Your browser gives this app <b>two separate stores</b> with very different limits. They are listed
        separately on purpose — adding them together would hide a full one behind an empty one.
      </div>

      <Tier
        title="Small store — saved plans"
        subtitle={localPct >= 90
          ? "Nearly full. When this fills, a plan can't be kept on this device — it still saves to your account."
          : "Where your plans, your version history and your settings are kept for offline use. This one is small and fixed."}
        usedBytes={snap.local.totalBytes}
        capBytes={LOCAL_CAP_BYTES}
        pct={localPct}
        classes={snap.local.classes}
      />

      <Tier
        title="Large store — images & map data"
        subtitle={snap.idb.supported
          ? `Where reference images and downloaded map data live. ${snap.idb.persisted ? "Your browser has been asked to keep this permanently, so it never clears it for you." : "Your browser may clear this if the disk gets tight."}`
          : "This browser doesn't report its large store."}
        usedBytes={snap.idb.usageBytes != null ? snap.idb.usageBytes : snap.idb.measuredBytes}
        capBytes={snap.idb.quotaBytes}
        pct={idbPct}
        classes={snap.idb.classes}
      />

      <div style={{ height: 1, background: PAL.line, margin: "14px 0 10px" }} />
      <button
        onClick={clearCache}
        disabled={busy || reclaimable <= 0}
        data-testid="clear-map-cache"
        style={{ width: "100%", padding: "8px 12px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", borderRadius: 8, cursor: busy || reclaimable <= 0 ? "default" : "pointer", border: `1px solid ${PAL.line}`, background: PAL.raised, color: PAL.ink, opacity: reclaimable <= 0 ? 0.55 : 1 }}
      >
        {busy ? "Clearing…" : reclaimable > 0 ? `Clear map data (${formatBytes(reclaimable)})` : "Clear map data"}
      </button>
      <div style={note}>
        Only clears things the app can download again — map layers and terrain. It never touches your plans,
        your version history, or a reference image that has no copy in your account.
      </div>
      {msg && <div role="status" style={{ ...note, color: PAL.ink, marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
