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
      <td>{msg(G.messaged)}</td>
      <td title="Imported into GHL but no message to them yet: pending, not counted as a failure or a non-responder">{msg(Math.max(0, G.importedProps - G.messaged))}</td><td>{msg(G.delivered)} <span className="muted">{pct(G.delivered, G.messaged)}</span></td>
      <td title="Unreachable, inactive or landline (carrier codes 30003-30006): a data-quality problem">{msg(G.badNumber)} <span className="muted">{pct(G.badNumber, G.messaged)}</span></td>
      <td title="Blocked by the carrier (30007): content or compliance, not the data">{msg(G.carrierBlock)}</td>
      <td title="Our account's daily sending limit or opt-out/error limit stopped it: capacity, not the data">{msg(G.platformLimit)}</td>
      <td title={`Pending ${G.pending.toLocaleString()} · other errors ${G.otherError.toLocaleString()}`}>{msg(G.pending + G.otherError)}</td>
      <td>{msg(G.optedOut)} <span className="muted">{pct(G.optedOut, G.messaged)}</span></td>
      <td>{n(G.contacted.size)}</td><td>{n(G.replied.size)} <span className="muted">{pct(G.replied.size, G.contacted.size)}</span></td>
      <td>{n(G.wrong.size)} <span className="muted">{pct(G.wrong.size, G.contacted.size)}</span></td><td><b>{n(G.qualified.size)}</b></td></tr>);
  const Q = ({ k, G, bold }: { k: string; G: Stage; bold?: boolean }) => { const q = G.q;
    return (<tr style={bold ? { fontWeight: 700 } : undefined}><td>{k}</td><td>{q.n ? n(q.unique) : "–"}</td>
      {[q.repeated, q.inDb, q.inTexting, q.shared, q.diffOwner].map((v, i) => <td key={i}>{q.n ? pct(v, q.unique) : <span className="muted">older upload</span>}</td>)}
      <td>{pct(G.removed, G.received)}</td><td><b>{messagesConnected ? pct(G.badNumber, G.messaged) : "–"}</b></td><td>{pct(G.wrong.size, G.contacted.size)}</td><td>{messagesConnected ? pct(G.optedOut, G.messaged) : "–"}</td></tr>); };
  return (<>
    <h2>Data lifecycle</h2>
    <p className="sub">From upload to lead. Up to "Prepared" comes from the Data Manager. Everything after that is confirmed by the platforms only:
      <b> Imported</b> = the number is on a GHL contact created after the export. <b>Waiting</b> = no number from that file is in GHL yet. <b>Missing</b> = the file was imported but this number never showed up (rejected or skipped; GHL doesn't report the reason).
      Messaging comes from GHL's own message records, one result per property (we send one message per property, to the primary number): delivered if any message got through,
      otherwise why it failed. <b>Bad number</b> is a data problem and counts against the list's quality; <b>carrier blocked</b>, <b>platform limit</b> and pending are operational and don't.
      <b>Waiting for outreach</b> = imported but not messaged yet: pending, never counted as failed or as a non-responder; rates use only properties actually messaged. Opted out = the GHL contact is DND.
      Contacted, replies, wrong numbers and leads count doors from the GHL pipeline.</p>
    <p>{BYS.map(([b, l]) => <a key={b} href={`/tracker?by=${b}`} className={`tag ${b === by ? "ok" : ""}`}>{l}</a>)}</p>
    <div className="tablewrap"><table><thead>
      <tr className="muted" style={{ fontSize: 12 }}><th></th><th colSpan={5}>Processed (Data Manager)</th><th>Exported</th><th colSpan={3}>Confirmed by GHL</th><th colSpan={2}>Outreach</th>
        <th>Delivery</th><th>Data quality</th><th colSpan={3}>Operational (not the data)</th><th>Opt-out</th><th colSpan={4}>Results (GHL pipeline)</th></tr>
      <tr><th>{label}</th><th>Properties</th><th>Numbers received</th><th>Removed in processing</th><th>Already in texting</th><th>Repeated in list</th>
      <th>Prepared for export</th><th>Imported ✓</th><th>Waiting for import</th><th>Missing after import</th><th>Doors messaged</th><th>Waiting for outreach</th><th>Delivered</th><th>Bad number</th><th>Carrier blocked</th><th>Platform limit</th><th>Pending / other</th><th>Opted out</th>
      <th>Contacted (doors)</th><th>Replied</th><th>Wrong #</th><th>Qualified</th></tr></thead><tbody>
      {rows.map(([k, G]) => <Row key={k} k={k} G={G} />)}
      {rows.length > 1 && <Row k="Total" G={total} bold />}
      {!rows.length && <tr><td colSpan={22} className="muted">Shows up after the first confirmed upload.</td></tr>}
    </tbody></table></div>
    <p className="muted" style={{ marginTop: 6 }}>Hover "Removed in processing" for the reasons. Units: numbers up to "Missing after import"; doors (properties) from "Doors messaged" on.</p>
    <h2>Data quality</h2>
    <p className="sub">Only things that say something about the data itself. Number-level shares are of each list's unique numbers (uploads before Nov 26 don't have that breakdown).
      Bad number and opt-out are % of properties actually messaged; wrong # is % of doors contacted. Operational problems (platform limits, carrier blocks, delays) are not included here.</p>
    <div className="tablewrap"><table><thead><tr><th>{label}</th><th>Unique numbers</th><th>Repeated in list</th><th>Already in our database</th><th>Already in texting</th><th>Shared with another property</th><th>…different owner</th><th>Removed in processing</th><th>Bad number</th><th>Wrong #</th><th>Opt-out</th></tr></thead><tbody>
      {rows.map(([k, G]) => <Q key={k} k={k} G={G} />)}
      {rows.length > 1 && <Q k="Total" G={total} bold />}
    </tbody></table></div>
  </>);
}
