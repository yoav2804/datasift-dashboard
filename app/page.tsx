import Nav from "./nav";
import { select } from "@/lib/sb";
import TaskActions from "./taskactions";
import { loadLists, today, weekStart, addDays, fmt, fmtLong, marketShort, daysBetween } from "@/lib/lists";
import { History, LastPulled, StatePill } from "./history";
export const dynamic = "force-dynamic";

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const zipText = (t: any) => t.zip_group === "ALL" || !t.zip_group ? "All ZIPs" : t.zips?.length ? `ZIP group ${t.zip_group}: ${t.zips.join(", ")}` : `ZIP group ${t.zip_group}: all other ZIPs`;
const estDoors = (t: any) => parseInt((t.notes || "").replace(/[^\d]/g, "")) || 0;

export default async function Calendar({ searchParams }: { searchParams: { week?: string } }) {
  const t0 = today(), thisWeek = weekStart(t0);
  const ws = weekStart(isDate(searchParams.week) ? searchParams.week! : t0), we = addDays(ws, 6);
  const isCurrent = ws === thisWeek, isPast = ws < thisWeek;
  const [{ tasks, prof, lists, listOf }, markets] = await Promise.all([loadLists(), select("markets", {})]);
  const mk = new Map(markets.map((m: any) => [m.fips, m]));
  const inWeek = (d?: string | null) => !!d && d >= ws && d <= we;
  const rank = (a: any, b: any) => { const pa: any = prof.get(a.profile_id) || {}, pb: any = prof.get(b.profile_id) || {};
    return (a.planned_date || "").localeCompare(b.planned_date || "") || (pa.priority - pb.priority) || (pa.doors_per_deal - pb.doors_per_deal) || a.pull_id.localeCompare(b.pull_id); };

  const toPull = tasks.filter((t: any) => t.status === "planned" && inWeek(t.planned_date)).sort(rank);
  const overdue = isCurrent ? tasks.filter((t: any) => t.status === "planned" && t.planned_date && t.planned_date < ws).sort(rank) : [];
  const skipped = tasks.filter((t: any) => t.status === "skipped" && inWeek(t.planned_date));
  const done: any[] = [];
  lists.forEach((L) => L.pulls.forEach((p) => { if (inWeek(p.date)) done.push({ L, p }); }));
  done.sort((a, b) => b.p.date.localeCompare(a.p.date));
  const byDay = new Map<string, any[]>();
  for (let i = 0; i < 7; i++) byDay.set(addDays(ws, i), []);
  toPull.forEach((t: any) => byDay.get(t.planned_date)!.push(t));
  const label = `${fmt(ws, { month: "short", day: "numeric" })} to ${fmt(we, { month: "short", day: "numeric", year: "numeric" })}`;
  const rel = isCurrent ? "This week" : ws === addDays(thisWeek, 7) ? "Next week" : ws === addDays(thisWeek, -7) ? "Last week"
    : isPast ? `${daysBetween(ws, thisWeek) / 7} weeks ago` : `In ${daysBetween(thisWeek, ws) / 7} weeks`;

  const Card = ({ t, late }: { t: any; late?: boolean }) => { const p: any = prof.get(t.profile_id) || {}; const m: any = mk.get(t.market_fips) || {}; const L = listOf(t);
    return (<div className="card">
      <div className="row"><div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>{p.name}</div>
        <div style={{ marginTop: 4 }}><span className="tag ok">{m.name || t.market_fips}</span><span className={`tag p${p.priority}`}>Priority {p.priority}</span>
          <span className="tag">{p.doors_per_deal} doors/deal</span>{late && <span className="tag warn">planned {fmt(t.planned_date)}, {daysBetween(t.planned_date, t0)} days late</span>}
          {isPast && !late && <span className="tag warn">not pulled</span>}</div>
        <div className="muted" style={{ marginTop: 6 }}>{zipText(t)}{estDoors(t) ? ` · about ${estDoors(t).toLocaleString()} new doors` : ""}</div>
        <div style={{ marginTop: 8 }}><LastPulled L={L} /></div>
      </div><TaskActions pullId={t.pull_id} /></div>
      {p.caveats && <div style={{ marginTop: 8 }}><span className="tag warn">{p.caveats}</span></div>}
      <div className="filter"><b>PropStream filters</b> {p.filter_status === "approved" ? <span className="tag ok">approved</span> : <span className="tag warn">draft, not verified</span>}
        <div>{p.filter_definition?.text || "Not drafted yet"}</div></div>
      <History L={L} />
    </div>); };

  return (<>
    <Nav on="Calendar" />
    <div className="weekbar">
      <a className="btn" href={`/?week=${addDays(ws, -7)}`} aria-label="Previous week">‹ Prev</a>
      <div className="weektitle"><div className="muted">{rel}</div><div>{label}</div></div>
      <a className="btn" href={`/?week=${addDays(ws, 7)}`} aria-label="Next week">Next ›</a>
      <form method="get" action="/" className="jump"><input type="date" name="week" defaultValue={ws} aria-label="Pick a date" /><button type="submit">Go</button></form>
      {!isCurrent && <a className="btn primary" href="/">Back to this week</a>}
    </div>
    <div className="grid">
      <div className="stat"><div className="big">{toPull.length}</div><div className="muted">to pull this week</div></div>
      <div className="stat"><div className="big">{done.length}</div><div className="muted">pulled this week</div></div>
      {isCurrent && <div className="stat"><div className="big" style={overdue.length ? { color: "var(--warn)" } : {}}>{overdue.length}</div><div className="muted">late from earlier weeks</div></div>}
      <div className="stat"><div className="big">{toPull.reduce((s: number, t: any) => s + estDoors(t), 0).toLocaleString()}</div><div className="muted">est. new doors</div></div>
    </div>

    {overdue.length > 0 && <><h2>Late: still waiting from earlier weeks</h2>
      <p className="sub">These were planned before this week and were not pulled yet. Pull them first, or press Skip.</p>
      {overdue.map((t: any) => <Card key={t.pull_id} t={t} late />)}</>}

    <h2>{isPast ? "Was planned this week" : "To pull"}</h2>
    {toPull.length === 0 && <p className="muted">Nothing planned for this week.</p>}
    {Array.from(byDay.entries()).filter(([, ts]) => ts.length).map(([d, ts]) => (<div key={d}>
      <div className="week">{fmt(d)} {d === t0 && <span className="tag ok">today</span>}{d < t0 && !isPast && <span className="tag warn">due</span>}
        <span className="muted">{ts.length} {ts.length === 1 ? "pull" : "pulls"}</span></div>
      {ts.map((t: any) => <Card key={t.pull_id} t={t} />)}</div>))}

    <h2>Pulled this week</h2>
    {done.length === 0 ? <p className="muted">Nothing pulled this week yet.</p> :
      <div className="tablewrap"><table><thead><tr><th>Date</th><th>List</th><th>Rows</th><th>New to us</th><th>To GHL</th><th>Next pull</th></tr></thead><tbody>
        {done.map(({ L, p }) => <tr key={p.pullId + p.date}><td>{fmt(p.date)}</td><td><b>{L.profile.name}</b><div className="muted">{marketShort(L.market)}{L.zipGroup !== "ALL" ? ` · ZIP group ${L.zipGroup}` : ""}</div></td>
          <td>{p.rows?.toLocaleString()}</td><td>{p.newProps?.toLocaleString() ?? "–"}</td><td>{p.importRows?.toLocaleString() ?? "–"}</td>
          <td>{L.nextDate ? fmtLong(L.nextDate) : "–"} <div><StatePill L={L} /></div></td></tr>)}
      </tbody></table></div>}

    {skipped.length > 0 && <><h2>Skipped this week</h2><div className="tablewrap"><table><tbody>
      {skipped.map((t: any) => <tr key={t.pull_id}><td className="muted">{fmt(t.planned_date)}</td><td className="muted">{(prof.get(t.profile_id) as any)?.name} · {marketShort(t.market_fips)}</td></tr>)}
    </tbody></table></div></>}
    <p className="muted" style={{ marginTop: 32 }}>Want every list in one place, with when it was last pulled? Open the <a href="/lists">List Log</a>.</p>
  </>);
}
