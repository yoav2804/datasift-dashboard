// ZIP coverage table for the Tracker: every target ZIP, from confirmed pulls and platform message records.
import { computePlan } from "@/lib/planner";
import { marketShort, fmtLong } from "@/lib/lists";
const n = (v: number) => (v ?? 0).toLocaleString();
const TAG: any = { this_week: "ok", recent: "ok", stale: "warn", neglected: "warn", never: "warn" };

export default async function ZipCoverage() {
  const P = await computePlan();
  const recs = [...P.picks, ...P.notPicked];
  const reach = (z: any) => recs.filter((r) => r.kind === "never" && r.market === z.market && (r.zipGroup === "ALL" || r.zipGroup === z.group));
  const order: any = { never: 0, neglected: 1, stale: 2, recent: 3, this_week: 4 };
  const zips = [...P.zips].sort((a, b) => order[a.status] - order[b.status] || a.market.localeCompare(b.market) || (a.rank ?? 99) - (b.rank ?? 99));
  const planned = (z: any) => P.picks.some((r) => r.market === z.market && (r.zipGroup === "ALL" || r.zipGroup === z.group));
  return (<>
    <h2>ZIP coverage</h2>
    <p className="sub">Our {zips.length} target ZIPs. Pulled = properties in confirmed uploads; outreach = properties whose first message went out (from the platform's records), counted on that day.
      Never-pulled data = DataSift lists that reach the ZIP and were never pulled. The weekly plan on the Calendar uses this to cover ZIPs that went quiet.</p>
    <div className="tablewrap"><table><thead><tr><th>ZIP</th><th>Market</th><th>Status</th><th>Last pull</th><th>Last outreach</th><th>Pulled this week</th><th>Messaged this week</th>
      <th>Outreach 30 / 60 / 90 days</th><th>Never-pulled lists reaching it</th><th>In this week's plan</th></tr></thead><tbody>
      {zips.map((z) => { const r = reach(z); return <tr key={z.zip}><td><b>{z.zip}</b>{z.group ? <div className="muted">group {z.group}</div> : null}</td><td>{marketShort(z.market)}</td>
        <td><span className={`tag ${TAG[z.status]}`}>{z.statusText}</span></td><td>{z.lastPull ? fmtLong(z.lastPull) : "–"}</td><td>{z.lastOutreach ? fmtLong(z.lastOutreach) : "–"}</td>
        <td>{n(z.pulledWeek)}</td><td>{n(z.messagedWeek)}</td><td>{n(z.m30)} / {n(z.m60)} / {n(z.m90)}</td>
        <td>{r.length ? `${r.length} (~${n(r.reduce((s, x) => s + x.est, 0))} est.)` : "–"}</td><td>{planned(z) ? "yes" : <span className="muted">no</span>}</td></tr>; })}
    </tbody></table></div></>);
}
