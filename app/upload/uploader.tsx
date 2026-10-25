"use client";
import { useState } from "react";
const LABELS: [string, string][] = [["rows_in_file", "Rows in file"], ["net_new_properties", "New properties"], ["already_known_properties", "Already known"],
  ["import_rows", "GHL import rows"], ["import_rows_new", "New contacts"], ["import_rows_duplicates", "Duplicates (included)"], ["import_rows_may_create_second_contact", "May create 2nd contact"],
  ["already_in_ghl", "Numbers already in GHL"], ["multi_property_review", "Multi-property"],
  ["landlines", "Landlines removed"], ["non_residential_numbers", "Non-residential removed"], ["litigator_numbers", "Litigator removed"]];
export default function Uploader({ options, preset }: { options: { id: string; label: string }[]; preset: string }) {
  const [pull, setPull] = useState(preset || options[0]?.id || ""); const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState(""); const [err, setErr] = useState(""); const [rep, setRep] = useState<any>(null);
  async function go() {
    setErr(""); setRep(null);
    try {
      setStep("Uploading file…");
      const u = await (await fetch("/api/upload-url", { method: "POST", body: JSON.stringify({ filename: file!.name }) })).json();
      const put = await fetch(u.url, { method: "PUT", body: file, headers: { "x-upsert": "false", "Content-Type": file!.type || "application/octet-stream" } });
      if (!put.ok) throw new Error("Upload failed: " + (await put.text()));
      setStep("Cleaning, matching against GHL, building lists… (up to a few minutes for big files)");
      const r = await (await fetch("/api/process", { method: "POST", body: JSON.stringify({ path: u.path, filename: file!.name, pullId: pull }) })).json();
      if (!r.ok) throw new Error(r.error);
      setRep(r.report); setStep("");
    } catch (e: any) { setErr(e.message); setStep(""); }
  }
  return (<div className="card">
    <div style={{ display: "grid", gap: 12 }}>
      <label><div className="muted">Pull</div><select value={pull} onChange={(e) => setPull(e.target.value)} style={{ width: "100%" }}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
      <label><div className="muted">PropStream export (.xlsx or .csv)</div><input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
      <div><button className="primary" disabled={!file || !pull || !!step} onClick={go}>Process</button></div>
      {step && <div className="muted">{step}</div>}
      {err && <div className="err">{err}</div>}
      {rep && <div>
        <h2 style={{ marginTop: 10 }}>Done</h2>
        <div className="grid">{LABELS.map(([k, l]) => <div className="stat" key={k}><div className="big">{rep[k] ?? 0}</div><div className="muted">{l}</div></div>)}</div>
        <p style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a className="btn primary" href={`/api/download?path=${encodeURIComponent(rep.files.import_csv)}`}>Download GHL import CSV</a>
          <a className="btn" href={`/api/download?path=${encodeURIComponent(rep.files.results)}`}>Download all lists (Excel)</a>
          {rep.multi_property_review > 0 && <a className="btn" href="/review">Review {rep.multi_property_review} cases</a>}</p>
      </div>}
    </div></div>);
}
