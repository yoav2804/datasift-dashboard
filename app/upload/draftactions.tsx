"use client";
import { useState } from "react";

// Confirm or undo a draft upload.
export default function DraftActions({ uploadId, results, warn }: { uploadId: string; results?: string; warn?: boolean }) {
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  async function act(action: "confirm" | "undo") {
    const msg = action === "confirm"
      ? `${warn ? "This draft has warnings. " : ""}Confirm export?\n\nThe GHL import file unlocks, this pull counts in the stats, and the next pull of this list is scheduled. A confirmed export can't be undone here.`
      : "Undo this upload?\n\nNothing will count from it: list stats, phone history, review cases and the export are voided, and the pull goes back on the calendar. You can then process the same file again under the right pull.";
    if (!confirm(msg)) return;
    setBusy(action === "confirm" ? "Confirming…" : "Undoing…"); setErr("");
    try {
      const r = await (await fetch("/api/upload-action", { method: "POST", body: JSON.stringify({ uploadId, action }) })).json();
      if (!r.ok) throw new Error(r.error);
      location.href = "/upload" + (action === "undo" ? "#voided" : "#done");
      location.reload();
    } catch (e: any) { setErr(e.message); setBusy(""); }
  }
  return (<div style={{ display: "grid", gap: 8 }}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {results && <a className="btn" href={`/api/download?path=${encodeURIComponent(results)}`}>Preview results (Excel)</a>}
      <button className="primary" disabled={!!busy} onClick={() => act("confirm")}>Confirm export</button>
      <button disabled={!!busy} onClick={() => act("undo")}>Undo</button>
    </div>
    {busy && <span className="muted">{busy}</span>}
    {err && <div className="err">{err}</div>}
  </div>);
}

// Process a voided upload's stored file again, under another pull.
export function Reprocess({ path, filename, options }: { path: string; filename: string; options: { id: string; label: string }[] }) {
  const [pull, setPull] = useState(""); const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  async function go() {
    setBusy("Processing… (up to a few minutes for big files)"); setErr("");
    try {
      const r = await (await fetch("/api/process", { method: "POST", body: JSON.stringify({ path, filename, pullId: pull }) })).json();
      if (!r.ok) throw new Error(r.error);
      location.href = "/upload#drafts"; location.reload();
    } catch (e: any) { setErr(e.message); setBusy(""); }
  }
  return (<div style={{ display: "grid", gap: 6 }}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <select value={pull} onChange={(e) => setPull(e.target.value)} style={{ flex: 1, minWidth: 220 }} aria-label="Pull to process under">
        <option value="">Process again under…</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
      <button className="primary" disabled={!pull || !!busy} onClick={go}>Process</button>
    </div>
    {busy && <span className="muted">{busy}</span>}
    {err && <div className="err">{err}</div>}
  </div>);
}
