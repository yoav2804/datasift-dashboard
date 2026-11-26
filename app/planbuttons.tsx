"use client";
import { useState } from "react";
async function post(body: any) { const r = await (await fetch("/api/plan", { method: "POST", body: JSON.stringify(body) })).json(); if (!r.ok) throw new Error(r.error); return r; }

export function AddToWeek({ k, week, all, label }: { k?: string; week: string; all?: boolean; label?: string }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  return (<span>
    <button className={all ? "primary" : ""} disabled={busy} onClick={async () => { setBusy(true); setErr("");
      try { await post({ action: all ? "add_all" : "add", key: k, week }); location.reload(); } catch (e: any) { setErr(e.message); setBusy(false); } }}>
      {busy ? "Adding…" : label || (all ? "Add all recommended to this week" : "Add to this week")}</button>
    {err && <span className="err" style={{ marginLeft: 8 }}>{err}</span>}</span>);
}

export function CapacityForm({ daily, days }: { daily: number; days: number }) {
  const [d, setD] = useState(String(daily)); const [w, setW] = useState(String(days)); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const weekly = (Number(d) || 0) * (Number(w) || 0);
  return (<div className="row" style={{ gap: 10, alignItems: "flex-end" }}>
    <label><div className="muted">New outreach per day (properties)</div><input type="number" min={1} value={d} onChange={(e) => setD(e.target.value)} style={{ width: 120 }} /></label>
    <label><div className="muted">Working days</div><input type="number" min={1} max={7} value={w} onChange={(e) => setW(e.target.value)} style={{ width: 80 }} /></label>
    <div><div className="muted">Weekly</div><b>{weekly.toLocaleString()}</b></div>
    <button disabled={busy} onClick={async () => { setBusy(true); setErr(""); try { await post({ action: "settings", daily_capacity: d, working_days: w }); location.reload(); } catch (e: any) { setErr(e.message); setBusy(false); } }}>Save</button>
    {err && <span className="err">{err}</span>}
  </div>);
}
