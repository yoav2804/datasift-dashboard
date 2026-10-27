import Nav from "../nav";
import { select } from "@/lib/sb";
import { loadLists, fmtLong, ago, marketShort, ListInfo } from "@/lib/lists";
import { History, StatePill } from "../history";
export const dynamic = "force-dynamic";

const order = (L: ListInfo) => (L.state === "ready" ? 0 : L.state === "never" && L.daysLeft <= 0 ? 1 : L.state === "waiting" || L.state === "never" ? 2 : 3);

export default async function ListLog({ searchParams }: { searchParams: { market?: string; show?: string } }) {
  const market = ["29510", "29189"].includes(searchParams.market || "") ? searchParams.market! : "all";
  const show = ["ready", "waiting", "never"].includes(searchParams.show || "") ? searchParams.show! : "all";
  const [{ lists, profiles }, markets, sources] = await Promise.all([loadLists(), select("markets", {}), select("sources", { kind: "eq.public_record", order: "source_id.asc" })]);
  const mk = new Map(markets.map((m: any) => [m.fips, m]));
  const all = Array.from(lists.values()).filter((L) => L.profile);
  const ready = (L: ListInfo) => L.daysLeft <= 0 && (L.state === "ready" || L.state === "never");
  const rows = all
    .filter((L) => market === "all" || L.market === market)
    .filter((L) => show === "all" || (show === "ready" ? ready(L) : show === "waiting" ? L.state === "waiting" : !L.last))
    .sort((a, b) => order(a) - order(b) || a.daysLeft - b.daysLeft || a.profile.name.localeCompare(b.profile.name));
  const q = (o: any) => { const p = new URLSearchParams({ market, show, ...o }); if (p.get("market") === "all") p.delete("market"); if (p.get("show") === "all") p.delete("show"); const s = p.toString(); return s ? `/lists?${s}` : "/lists"; };
  const count = { ready: all.filter(ready).length, waiting: all.filter((L) => L.state === "waiting").length, pulled: all.filter((L) => L.last).length };
  const dsOnly = profiles.filter((p: any) => !p.source_id && p.priority !== 3).sort((a: any, b: any) => a.doors_per_deal - b.doors_per_deal);

  return (<>
    <Nav on="List Log" />
    <h1>List Log</h1>
    <p className="sub">Every list, when it was last pulled, and when it is time to pull it again. Press the arrow on any list to see every time it was pulled.</p>
    <div className="grid">
      <div className="stat"><div className="big" style={{ color: "var(--accent)" }}>{count.ready}</div><div className="muted">ready to pull now</div></div>
      <div className="stat"><div className="big">{count.waiting}</div><div className="muted">pulled, waiting</div></div>
      <div className="stat"><div className="big">{count.pulled} / {all.length}</div><div className="muted">lists pulled at least once</div></div>
    </div>
    <div className="chips">
      <span className="muted">Market:</span>
      {[["all", "Both"], ["29510", "City"], ["29189", "County"]].map(([v, l]) => <a key={v} href={q({ market: v })} className={`chip ${market === v ? "on" : ""}`}>{l}</a>)}
      <span className="muted" style={{ marginLeft: 12 }}>Show:</span>
      {[["all", "All"], ["ready", "Ready now"], ["waiting", "Waiting"], ["never", "Never pulled"]].map(([v, l]) => <a key={v} href={q({ show: v })} className={`chip ${show === v ? "on" : ""}`}>{l}</a>)}
    </div>

    <div className="loghead"><div>List</div><div>Last pulled</div><div>Next pull</div><div>Status</div></div>
    {rows.length === 0 && <p className="muted">No lists match.</p>}
    {rows.map((L) => (<details className="logrow" key={L.key}>
      <summary>
        <div><span className="chev" aria-hidden>›</span><b>{L.profile.name}</b>
          <div className="muted sub2">{marketShort(L.market)}{L.zipGroup !== "ALL" ? ` · ZIP group ${L.zipGroup}` : " · all ZIPs"} · pulled {L.pulls.length}×</div></div>
        <div><span className="mlabel">Last pulled</span>{L.last ? <>{fmtLong(L.last.date)}<div className="muted">{ago(L.last.date)}</div></> : <span className="muted">Never</span>}</div>
        <div><span className="mlabel">Next pull</span>{L.nextDate ? fmtLong(L.nextDate) : <span className="muted">Not scheduled</span>}</div>
        <div><StatePill L={L} /></div>
      </summary>
      <div className="logbody">
        {L.zips?.length ? <div className="muted">ZIPs: {L.zips.join(", ")}</div> : null}
        <div className="filter"><b>PropStream filters</b><div>{L.profile.filter_definition?.text || "Not drafted yet"}</div></div>
        <History L={L} title="Every time this list was pulled" open />
      </div>
    </details>))}

    <h2>First to market: pull at the source</h2>
    <p className="sub">Public records that hit the county 30 to 90 days before any provider list. Links still need to be checked before you rely on them.</p>
    <div className="tablewrap"><table><thead><tr><th>Market</th><th>Source</th><th>Updates</th><th>Link</th></tr></thead><tbody>
      {sources.map((s: any) => <tr key={s.source_id}><td>{(mk.get(s.market_fips) as any)?.name || s.market_fips}</td><td>{s.name}</td><td>{s.update_frequency}</td>
        <td>{s.url ? <a href={s.url} target="_blank">Open ↗</a> : ""}</td></tr>)}
    </tbody></table></div>
    <h2>Good lists PropStream can't pull</h2>
    <p className="sub">DataSift ranks these well, but they need DataSift's own data, so they are not on the calendar.</p>
    <div className="tablewrap"><table><thead><tr><th>Market</th><th>List</th><th>Doors/deal</th><th>Missing</th></tr></thead><tbody>
      {dsOnly.map((p: any) => <tr key={p.profile_id}><td>{(mk.get(p.market_fips) as any)?.name}</td><td>{p.name}</td><td>{p.doors_per_deal}</td><td>{(p.filter_definition?.gaps || []).join(", ")}</td></tr>)}
    </tbody></table></div>
  </>);
}
