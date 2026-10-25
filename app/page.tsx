import Nav from "./nav";
import { select } from "@/lib/sb";
import TaskActions from "./taskactions";
export const dynamic = "force-dynamic";

const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
export default async function Calendar() {
  const [tasks, profiles, markets, sources] = await Promise.all([
    select("pull_tasks", { order: "planned_date.asc,pull_id.asc" }),
    select("profiles", {}), select("markets", { active: "eq.true" }), select("sources", { kind: "eq.public_record", order: "source_id.asc" })]);
  const prof = new Map(profiles.map((p: any) => [p.profile_id, p]));
  const mk = new Map(markets.map((m: any) => [m.fips, m]));
  const open = tasks.filter((t: any) => t.status === "planned" && t.planned_date);
  const done = tasks.filter((t: any) => t.status !== "planned" && t.status !== "skipped");
  const today = new Date().toISOString().slice(0, 10);
  const next = open[0];
  const byDate = new Map<string, any[]>();
  open.forEach((t: any) => byDate.set(t.planned_date, [...(byDate.get(t.planned_date) || []), t]));
  byDate.forEach((ts) => ts.sort((a, b) => { const pa: any = prof.get(a.profile_id) || {}, pb: any = prof.get(b.profile_id) || {};
    return (pa.priority - pb.priority) || (pa.doors_per_deal - pb.doors_per_deal) || a.pull_id.localeCompare(b.pull_id); }));
  const zipText = (t: any) => t.zip_group === "ALL" ? "All ZIPs" : t.zips?.length ? `ZIP group ${t.zip_group}: ${t.zips.join(", ")}` : `ZIP group ${t.zip_group}: all other ZIPs`;
  const dsOnly = profiles.filter((p: any) => !p.source_id && p.priority !== 3).sort((a: any, b: any) => a.doors_per_deal - b.doors_per_deal);
  return (<>
    <Nav on="Calendar" />
    <h1>Pull Calendar</h1>
    <p className="sub">What to pull, in what order. Both markets are ranked together: the list with the cheapest next deal (lowest doors per deal) comes first.</p>
    <div className="grid">
      <div className="stat"><div className="big">{open.length}</div><div className="muted">pulls planned</div></div>
      <div className="stat"><div className="big">{done.length}</div><div className="muted">pulls processed</div></div>
      <div className="stat"><div className="big">{next ? fmt(next.planned_date) : "None"}</div><div className="muted">next pull day</div></div>
      {markets.map((m: any) => <div className="stat" key={m.fips}><div className="big">{m.baseline_doors_per_deal}</div><div className="muted">{m.name} baseline doors/deal</div></div>)}
    </div>
    {Array.from(byDate.entries()).map(([d, ts]) => (
      <div key={d}>
        <div className="week">{fmt(d)} {d <= today && <span className="tag warn">due</span>}
          <span className="muted">{ts.length} pulls · est. {ts.reduce((s, t) => s + (parseInt((t.notes || "").replace(/[^\d]/g, "")) || 0), 0).toLocaleString()} new doors</span></div>
        {ts.map((t: any) => { const p: any = prof.get(t.profile_id) || {}; const m: any = mk.get(t.market_fips) || {};
          return (<div className="card" key={t.pull_id}>
            <div className="row"><div>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{p.name}</div>
              <div style={{ marginTop: 4 }}><span className="tag ok">{m.name || t.market_fips}</span><span className={`tag p${p.priority}`}>Priority {p.priority}</span>
                <span className="tag">{p.doors_per_deal} doors/deal</span><span className="tag">{p.vs_baseline}x baseline</span><span className="tag">rung {p.rung}</span></div>
              {p.caveats && <div style={{ marginTop: 6 }}><span className="tag warn">{p.caveats}</span></div>}
              <div className="muted" style={{ marginTop: 6 }}>{zipText(t)} · {t.notes} · <code>{t.pull_id}</code></div>
            </div><TaskActions pullId={t.pull_id} /></div>
            <div className="filter"><b>PropStream filters</b> {p.filter_status === "approved" ? <span className="tag ok">approved</span> : <span className="tag warn">draft, not verified</span>}
              <div>{p.filter_definition?.text || "Not drafted yet"}</div></div>
          </div>); })}
      </div>))}
    <h2>First to market: pull at the source</h2>
    <p className="sub">Public records that hit the county 30 to 90 days before any provider list. Pull new filings, put the addresses into PropStream, skip trace, export, then upload. Links still need to be checked before you rely on them.</p>
    <div className="tablewrap"><table><thead><tr><th>Market</th><th>Source</th><th>Updates</th><th>Link</th></tr></thead><tbody>
      {sources.map((s: any) => <tr key={s.source_id}><td>{mk.get(s.market_fips)?.name || s.market_fips}</td><td>{s.name}</td><td>{s.update_frequency}</td>
        <td>{s.url ? <a href={s.url} target="_blank">Open ↗</a> : ""}</td></tr>)}
    </tbody></table></div>
    <h2>Good lists PropStream can't pull</h2>
    <p className="sub">DataSift ranks these well, but they need DataSift's own data (SiftMap), so they are not on the calendar.</p>
    <div className="tablewrap"><table><thead><tr><th>Market</th><th>List</th><th>Doors/deal</th><th>Priority</th><th>Missing</th></tr></thead><tbody>
      {dsOnly.map((p: any) => <tr key={p.profile_id}><td>{mk.get(p.market_fips)?.name}</td><td>{p.name}</td><td>{p.doors_per_deal}</td><td>{p.priority}</td><td>{(p.filter_definition?.gaps || []).join(", ")}</td></tr>)}
    </tbody></table></div>
    {done.length > 0 && <><h2>Done</h2><div className="tablewrap"><table><thead><tr><th>Pull</th><th>Date</th><th>Rows</th><th>New properties</th><th>Import rows</th></tr></thead>
      <tbody>{done.map((t: any) => <tr key={t.pull_id}><td><code>{t.pull_id}</code></td><td>{t.completed_date}</td><td>{t.rows_pulled}</td><td>{t.net_new_properties}</td><td>{t.contacts_generated}</td></tr>)}</tbody></table></div></>}
  </>);
}
