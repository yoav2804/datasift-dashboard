"use client";
import { useState } from "react";
export default function Login() {
  const [pw, setPw] = useState(""); const [err, setErr] = useState("");
  async function go(e: any) { e.preventDefault();
    const r = await fetch("/api/login", { method: "POST", body: JSON.stringify({ password: pw }) });
    if (r.ok) location.href = "/"; else setErr("Wrong password"); }
  return (<div style={{ maxWidth: 360, margin: "120px auto" }}><h1>DataSift Ops</h1><p className="sub">TJ INVEST LLC</p>
    <form onSubmit={go} style={{ display: "flex", gap: 8 }}><input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ flex: 1 }} />
    <button className="primary">Enter</button></form>{err && <p className="err" style={{ marginTop: 12 }}>{err}</p>}</div>);
}
