"use client";
import { useState } from "react";
export default function SyncButton() {
  const [s, setS] = useState("");
  async function go() { setS("Syncing GHL contacts (about a minute)…"); const r = await (await fetch("/api/sync-ghl")).json();
    setS(r.ok ? `Done: ${r.contacts.toLocaleString()} contacts` : `Error: ${r.error}`); setTimeout(() => location.reload(), 1500); }
  return (<div style={{ display: "grid", gap: 6, justifyItems: "end" }}><button onClick={go} disabled={!!s && !s.startsWith("Done")}>Refresh GHL copy now</button><span className="muted">{s || "Runs on its own every night"}</span></div>);
}
