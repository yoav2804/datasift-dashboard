"use client";
export default function Decide({ id, status }: { id: string; status: string }) {
  async function set(s: string) { await fetch("/api/review", { method: "POST", body: JSON.stringify({ caseId: id, status: s }) }); location.reload(); }
  if (status !== "open") return (<div style={{ display: "grid", gap: 6 }}><span className="tag ok">{status === "new_opportunity" ? "New opportunity" : "Ignored"}</span><button onClick={() => set("open")}>Reopen</button></div>);
  return (<div style={{ display: "grid", gap: 8 }}><button className="primary" onClick={() => set("new_opportunity")}>New opportunity</button><button onClick={() => set("ignore")}>Ignore</button></div>);
}
