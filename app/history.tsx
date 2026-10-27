// The arrow that opens the full pull log of one list. No client JavaScript needed.
import { ListInfo, fmtLong, ago } from "@/lib/lists";

const dl = (p: string) => `/api/download?path=${encodeURIComponent(p)}`;
export function LastPulled({ L }: { L: ListInfo | null }) {
  if (!L?.last) return <span className="muted">Never pulled</span>;
  return <span><b>Last pulled {fmtLong(L.last.date)}</b> <span className="muted">· {ago(L.last.date)}</span></span>;
}
export function StatePill({ L }: { L: ListInfo | null }) {
  if (!L) return null;
  const cls = L.state === "ready" || (L.state === "never" && L.daysLeft <= 0) ? "pill go" : "pill wait";
  return <span className={cls}>{L.stateText}</span>;
}
export function History({ L, title = "Pull history", open = false }: { L: ListInfo | null; title?: string; open?: boolean }) {
  if (!L) return null;
  return (<details className="hist" open={open}>
    <summary><span className="chev" aria-hidden>›</span>{title} <span className="muted">({L.pulls.length} {L.pulls.length === 1 ? "pull" : "pulls"})</span></summary>
    {L.pulls.length ? <div className="tablewrap" style={{ marginTop: 10 }}><table><thead><tr><th>Date pulled</th><th>Rows</th><th>New to us</th><th>New to this list</th><th>To GHL</th><th>Files</th></tr></thead><tbody>
      {L.pulls.map((p) => <tr key={p.pullId + p.date}>
        <td><b>{fmtLong(p.date)}</b><div className="muted">{ago(p.date)} · <code>{p.pullId}</code></div></td>
        <td>{p.rows?.toLocaleString()}</td><td>{p.newProps?.toLocaleString() ?? "–"}</td>
        <td>{L.pulls.length > 1 && p !== L.pulls[L.pulls.length - 1] && p.pctNewToList != null ? `${p.pctNewToList}%` : <span className="muted">first pull</span>}</td>
        <td>{p.importRows?.toLocaleString() ?? "–"}</td>
        <td>{p.files ? <><a href={dl(p.files.results)}>Results</a> · <a href={dl(p.files.import_csv)}>GHL CSV</a></> : ""}</td></tr>)}
    </tbody></table></div> : <p className="muted" style={{ margin: "8px 0 0" }}>This list has not been pulled yet.</p>}
  </details>);
}
