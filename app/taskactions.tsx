"use client";
export default function TaskActions({ pullId, draft }: { pullId: string; draft?: boolean }) {
  async function skip() { if (!confirm("Skip this pull?")) return;
    await fetch("/api/task", { method: "POST", body: JSON.stringify({ pullId, status: "skipped" }) }); location.reload(); }
  if (draft) return (<div style={{ display: "flex", gap: 8 }}><a className="btn primary" href="/upload#drafts">Open draft</a></div>);
  return (<div style={{ display: "flex", gap: 8 }}><a className="btn primary" href={`/upload?pull=${encodeURIComponent(pullId)}`}>Upload file</a><button onClick={skip}>Skip</button></div>);
}
