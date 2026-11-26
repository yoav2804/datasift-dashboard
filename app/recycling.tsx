// Smart recycling tables, shared by the Tracker and the List Log.
import type { ListRecycle } from "@/lib/recycling";
import { fmtLong } from "@/lib/lists";
const n = (v: number) => (v ?? 0).toLocaleString();
const p1 = (v: number | null | undefined) => (v == null ? "–" : `${(v * 100).toFixed(1)}%`);

export function RecycleSummary({ R }: { R: ListRecycle | undefined }) {
  if (!R) return <p className="muted">Smart recycling starts after the first confirmed pull.</p>;
  return (<div style={{ marginTop: 8 }}><b>Smart recycling:</b>{" "}
    {R.measured ? <>learned refresh <b>{p1(R.learnedPerMonth)} a month</b> over {R.repulls.length} re-pull{R.repulls.length === 1 ? "" : "s"}</> : <>not measured yet (needs a second pull)</>}
    {" · "}pull every <b>{R.interval} days</b> · recommended next pull <b>{fmtLong(R.nextDate)}</b></div>);
}

export function RecycleHistory({ R }: { R: ListRecycle | undefined }) {
  if (!R?.repulls.length) return null;
  return (<div className="tablewrap" style={{ marginTop: 8 }}><table><thead><tr><th>Re-pull</th><th>Days since previous</th><th>Previous → now</th><th>Stayed</th><th>New</th><th>Dropped (no longer qualify)</th>
    <th>Owner changed</th><th>Phones changed</th><th>Refresh</th><th>Size change</th><th>Refresh per month</th></tr></thead><tbody>
    {R.repulls.map((r) => <tr key={r.pullId}><td>{fmtLong(r.date)}</td><td>{r.days}</td><td>{n(r.prev)} → {n(r.cur)}</td><td>{n(r.remained)}</td><td><b>{n(r.added)}</b></td><td>{n(r.dropped)}</td>
      <td>{n(r.ownerChanged)}</td><td>{n(r.phonesChanged)}</td><td><b>{p1(r.refresh)}</b></td><td>{p1(r.growth)}</td><td>{p1(r.perMonth)}</td></tr>)}
  </tbody></table></div>);
}

export function RecyclingTable({ rows, names }: { rows: ListRecycle[]; names: Map<string, string> }) {
  return (<>
    <h2>Smart recycling</h2>
    <p className="sub">Every re-pull is compared with the list's previous confirmed pull. <b>Refresh</b> = share of the new pull that wasn't on the previous one (new data even if the size didn't change); <b>size change</b> = growth.
      The learned monthly refresh (recent re-pulls count more) sets how often the list is pulled: 50%+ a month → 30 days, 25%+ → 60, 10%+ → 90, less → 180. Until a list is pulled twice it is re-pulled after 30 days to measure it.</p>
    <div className="tablewrap"><table><thead><tr><th>List</th><th>Pulls</th><th>Last pulled</th><th>Last re-pull: new / dropped</th><th>Owner / phone changes</th><th>Last refresh</th><th>Size change</th>
      <th>Learned refresh / month</th><th>Every</th><th>Next pull</th><th>Outreach yield (last pull)</th></tr></thead><tbody>
      {rows.map((R) => { const r = R.repulls[0];
        return <tr key={R.key}><td>{names.get(R.key) || R.key}</td><td>{R.pulls}</td><td>{fmtLong(R.lastDate)}</td>
          <td>{r ? `${n(r.added)} / ${n(r.dropped)}` : <span className="muted">first pull</span>}</td><td>{r ? `${n(r.ownerChanged)} / ${n(r.phonesChanged)}` : "–"}</td>
          <td>{r ? p1(r.refresh) : "–"}</td><td>{r ? p1(r.growth) : "–"}</td><td><b>{R.measured ? p1(R.learnedPerMonth) : <span className="muted">not measured</span>}</b></td>
          <td>{R.interval} days</td><td>{fmtLong(R.nextDate)}</td><td>{p1(R.lastYield)}</td></tr>; })}
      {!rows.length && <tr><td colSpan={11} className="muted">Shows up after the first confirmed pull.</td></tr>}
    </tbody></table></div></>);
}
