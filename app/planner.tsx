// Weekly planner section for the Calendar.
import { computePlan } from "@/lib/planner";
import { marketShort, fmt } from "@/lib/lists";
import { AddToWeek, CapacityForm } from "./planbuttons";
const n = (v: number) => Math.round(v || 0).toLocaleString();
const MKTS = ["29510", "29189", "29183"];

export default async function Planner({ week }: { week: string }) {
  const P = await computePlan(week);
  const pct = P.capacity ? Math.min(100, Math.round(((P.used + P.planned) / P.capacity) * 100)) : 0;
  const pickBy = (m: string) => P.picks.filter((r) => r.market === m).reduce((s, r) => s + r.est, 0);
  const Row = ({ r, picked }: { r: any; picked?: boolean }) => {
    const here = r.plannedTask && r.plannedTask.planned_date >= P.ws && r.plannedTask.planned_date <= P.we;
    return (<tr><td><b>{r.name}</b><div className="muted">{marketShort(r.market)} · {r.zipGroup === "ALL" ? "all ZIPs" : `ZIP group ${r.zipGroup}`}</div></td>
      <td>{r.kind === "never" ? <span className="tag ok">never pulled</span> : <span className="tag">recycle due{r.dueDate ? ` ${fmt(r.dueDate, { month: "short", day: "numeric" })}` : ""}</span>}</td>
      <td>P{r.priority}{r.dpd ? <div className="muted">{r.dpd} doors/deal</div> : null}</td>
      <td title={r.estHow}><b>{n(r.est)}</b><div className="muted" style={{ fontSize: 12 }}>{r.estHow}</div></td>
      <td>{r.lastPulled ? fmt(r.lastPulled, { month: "short", day: "numeric" }) : "–"}</td>
      <td>{here ? <span className="tag ok">on this week</span> : <AddToWeek k={r.key} week={P.ws} label={r.plannedTask ? "Move to this week" : picked ? "Add to this week" : "Add anyway"} />}</td></tr>);
  };
  return (<div className="card" style={{ marginBottom: 18 }}>
    <h2 style={{ marginTop: 0 }}>Weekly plan</h2>
    <p className="sub">Capacity counts properties: one new outreach message per property, to its primary number. Never-pulled lists come first, then lists due for recycling; markets are kept balanced.
      Estimates come from our own history and are replaced by the real numbers as files are uploaded.</p>
    <CapacityForm daily={P.settings.daily_capacity} days={P.settings.working_days} />
    <div className="grid" style={{ marginTop: 14 }}>
      <div className="stat"><div className="big">{n(P.capacity)}</div><div className="muted">weekly capacity</div></div>
      <div className="stat"><div className="big">{n(P.used)}</div><div className="muted">already exported this week (actual)</div></div>
      <div className="stat"><div className="big">{n(P.planned)}</div><div className="muted">recommended (estimate)</div></div>
      <div className="stat"><div className="big">{n(P.remaining)}</div><div className="muted">capacity left after plan</div></div>
    </div>
    <div style={{ background: "var(--bg)", borderRadius: 6, height: 10, marginTop: 10, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: "var(--ok, #2a7)" }} /></div>
    <p className="muted" style={{ marginTop: 8 }}>By market (actual + recommended): {MKTS.map((m) => `${marketShort(m)} ${n((P.usedBy[m] || 0) + pickBy(m))}`).join(" · ")}</p>
    <div className="row" style={{ justifyContent: "space-between", marginTop: 10 }}><b>Recommended this week ({P.picks.length})</b>{P.picks.length > 0 && <AddToWeek week={P.ws} all />}</div>
    <div className="tablewrap"><table><thead><tr><th>List</th><th>Why</th><th>DataSift</th><th>Est. properties to outreach</th><th>Last pulled</th><th></th></tr></thead><tbody>
      {P.picks.map((r) => <Row key={r.key} r={r} picked />)}
      {!P.picks.length && <tr><td colSpan={6} className="muted">{P.used >= P.capacity ? "This week's capacity is already used." : "Nothing eligible: every list is waiting for its recycle date."}</td></tr>}
    </tbody></table></div>
    {P.notPicked.length > 0 && <details style={{ marginTop: 10 }}><summary>Next in line ({P.notPicked.length})</summary>
      <div className="tablewrap"><table><tbody>{P.notPicked.slice(0, 25).map((r) => <Row key={r.key} r={r} />)}</tbody></table></div></details>}
  </div>);
}
