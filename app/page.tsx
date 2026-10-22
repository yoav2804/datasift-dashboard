import Nav from "./nav";
import { select } from "@/lib/sb";
import TaskActions from "./taskactions";
export const dynamic = "force-dynamic";

const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
export default async function Calendar() {
  const [tasks, profiles, zips] = await Promise.all([
    select("pull_tasks", { order: "planned_date.asc,pull_id.asc" }),
    select("profiles", {}), select("zip_priorities", { order: "rank.asc" })]);
  const prof = new Map(profiles.map((p: any) => [p.profile_id, p]));
  const groups: Record<string, string[]> = {};
  zips.forEach((z: any) => (groups[z.zip_group] ||= []).push(z.zip));
  const open = tasks.filter((t: any) => t.status === "planned" && t.planned_date);
  const done = tasks.filter((t: any) => t.status !== "planned" && t.status !== "skipped");
  const today = new Date().toISOString().slice(0, 10);
  const next = open[0];
  const byDate = new Map<string, any[]>();
  open.forEach((t: any) => byDate.set(t.planned_date, [...(byDate.get(t.planned_date) || []), t]));
  const zipText = (t: any) => t.zip_group === "ALL" ? "All City ZIPs" : t.zip_group === "D" ? "Group D: all other City ZIPs" : t.zips?.length ? `Group ${t.zip_group}: ${t.zips.join(", ")}` : t.zip_group || "";
  return (<>
    <Nav on="Calendar" />
    <h1>Pull Calendar</h1>
    <p className="sub">What to pull, in what order. Pull in PropStream, then upload the file on the Upload tab.</p>
    <div className="grid">
      <div className="stat"><div className="big">{open.length}</div><div className="muted">pulls planned</div></div>
      <div className="stat"><div className="big">{done.length}</div><div className="muted">pulls processed</div></div>
      <div className="stat"><div className="big">{next ? fmt(next.planned_date) : "None"}</div><div className="muted">next pull day</div></div>
      <div className="stat"><div className="big">{profiles.filter((p: any) => p.filter_status === "approved").length}/{profiles.length}</div><div className="muted">list filters approved</div></div>
    </div>
    {Array.from(byDate.entries()).map(([d, ts]) => (
      <div key={d}>
        <div className="week">{fmt(d)} {d <= today && <span className="tag warn">due</span>}
          <span className="muted">{ts.length} pulls · est. {ts.reduce((s, t) => s + (parseInt((t.notes || "").replace(/[^\d]/g, "")) || 0), 0).toLocaleString()} new doors</span></div>
        {ts.map((t: any) => { const p: any = prof.get(t.profile_id) || {};
          return (<div className="card" key={t.pull_id}>
            <div className="row"><div>
              <div style={{ fontWeight: 700, fontSize: 17 }}>#{p.rung} {p.name}</div>
              <div style={{ marginTop: 4 }}><span className={`tag p${p.priority}`}>Priority {p.priority}</span><span className="tag">{p.list_type}</span>
                <span className="tag">{p.doors_per_deal} doors/deal</span>{p.caveats && <span className="tag warn">{p.caveats}</span>}</div>
              <div className="muted" style={{ marginTop: 6 }}>{zipText(t)} · {t.notes} · <code>{t.pull_id}</code></div>
            </div><TaskActions pullId={t.pull_id} /></div>
            <div className="filter"><b>PropStream filters</b> {p.filter_status === "approved" ? <span className="tag ok">approved</span> : <span className="tag warn">draft, not verified</span>}
              <div>{p.filter_definition?.text || "Not drafted yet"}</div></div>
          </div>); })}
      </div>))}
    {done.length > 0 && <><h2>Done</h2><div className="tablewrap"><table><thead><tr><th>Pull</th><th>Date</th><th>Rows</th><th>New properties</th><th>Import rows</th></tr></thead>
      <tbody>{done.map((t: any) => <tr key={t.pull_id}><td><code>{t.pull_id}</code></td><td>{t.completed_date}</td><td>{t.rows_pulled}</td><td>{t.net_new_properties}</td><td>{t.contacts_generated}</td></tr>)}</tbody></table></div></>}
  </>);
}
