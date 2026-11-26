// Data lifecycle table: where numbers go from upload to lead, and where they are lost.
import { loadLifecycle, By, Stage } from "@/lib/lifecycle";
const n = (v: number) => (v ?? 0).toLocaleString();
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "–");
const BYS: [By, string][] = [["list", "List"], ["market", "Market"], ["source", "Original source"], ["provider", "Skip trace provider"]];
const why = (G: Stage) => Object.entries(G.removedWhy).sort((a, b) => b[1] - a[1]).map(([w, c]) => `${w}: ${c.toLocaleString()}`).join(" · ");

export default async function Lifecycle({ by }: { by: By }) {
  const { rows, total, messagesConnected } = await loadLifecycle(by);
  const label = BYS.find(([b]) => b === by)![1];
  const msg = (v: number) => (messagesConnected ? n(v) : <span className="muted" title="Message delivery is not connected yet (GHL messages or Textivo)">not connected</span>);
  const Row = ({ k, G, bold }: { k: string; G: Stage; bold?: boolean }) => (
    <tr style={bold ? { fontWeight: 700 } : undefined}><td>{k}</td><td>{n(G.properties)}</td><td>{n(G.received)}</td>
      <td title={why(G)}>{n(G.removed)} <span className="muted">{pct(G.removed, G.received)}</span></td>
      <td>{n(G.inTexting)}</td><td>{n(G.repeated)}</td><td><b>{n(G.prepared)}</b></td>
      <td><b>{n(G.imported)}</b> <span className="muted">{pct(G.imported, G.prepared)}</span></td><td>{n(G.waiting)}</td>
      <td>{n(G.missing)} <span className="muted">{pct(G.missing, G.prepared)}</span></td>
      <td>{msg(G.msgSent)}</td><td>{msg(G.delivered)}</td><td>{msg(G.failed)}</td>
      <td>{n(G.contacted.size)}</td><td>{n(G.replied.size)} <span className="muted">{pct(G.replied.size, G.contacted.size)}</span></td>
      <td>{n(G.wrong.size)} <span className="muted">{pct(G.wrong.size, G.contacted.size)}</span></td><td><b>{n(G.qualified.size)}</b></td></tr>);
  const Q = ({ k, G, bold }: { k: string; G: Stage; bold?: boolean }) => { const q = G.q;
    return (<tr style={bold ? { fontWeight: 700 } : undefined}><td>{k}</td><td>{q.n ? n(q.unique) : "–"}</td>
      {[q.repeated, q.inDb, q.inTexting, q.shared, q.diffOwner].map((v, i) => <td key={i}>{q.n ? pct(v, q.unique) : <span className="muted">older upload</span>}</td>)}</tr>); };
  return (<>
    <h2>Data lifecycle</h2>
    <p className="sub">From upload to lead. Up to "Prepared" comes from the Data Manager. Everything after that is confirmed by the platforms only:
      <b> Imported</b> = the number is on a GHL contact created after the export. <b>Waiting</b> = no number from that file is in GHL yet. <b>Missing</b> = the file was imported but this number never showed up (rejected or skipped; GHL doesn't report the reason).
      Contacted, replies, wrong numbers and leads count doors from the GHL pipeline.</p>
    <p>{BYS.map(([b, l]) => <a key={b} href={`/tracker?by=${b}`} className={`tag ${b === by ? "ok" : ""}`}>{l}</a>)}</p>
    <div className="tablewrap"><table><thead><tr><th>{label}</th><th>Properties</th><th>Numbers received</th><th>Removed in processing</th><th>Already in texting</th><th>Repeated in list</th>
      <th>Prepared for export</th><th>Imported ✓</th><th>Waiting for import</th><th>Missing after import</th><th>Messages sent</th><th>Delivered</th><th>Failed</th>
      <th>Contacted (doors)</th><th>Replied</th><th>Wrong #</th><th>Qualified</th></tr></thead><tbody>
      {rows.map(([k, G]) => <Row key={k} k={k} G={G} />)}
      {rows.length > 1 && <Row k="Total" G={total} bold />}
      {!rows.length && <tr><td colSpan={17} className="muted">Shows up after the first confirmed upload.</td></tr>}
    </tbody></table></div>
    <p className="muted" style={{ marginTop: 6 }}>Hover "Removed in processing" for the reasons. Units: numbers, except properties and the last four columns (doors).</p>
    <h2>Data quality (numbers)</h2>
    <p className="sub">Share of each list's unique numbers. Uploads before Nov 26 don't have this breakdown.</p>
    <div className="tablewrap"><table><thead><tr><th>{label}</th><th>Unique numbers</th><th>Repeated in list</th><th>Already in our database</th><th>Already in texting</th><th>Shared with another property</th><th>…different owner</th></tr></thead><tbody>
      {rows.map(([k, G]) => <Q key={k} k={k} G={G} />)}
      {rows.length > 1 && <Q k="Total" G={total} bold />}
    </tbody></table></div>
  </>);
}
