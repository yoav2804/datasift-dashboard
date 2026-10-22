import Nav from "../nav";
import { select } from "@/lib/sb";
import SyncButton from "./sync";
export const dynamic = "force-dynamic";
const n = (v: any) => (v ?? 0).toLocaleString();
export default async function Tracker() {
  const [batches, tasks, profiles, zips, markets, ghlDnd, reviewOpen] = await Promise.all([
    select("export_batches", { select: "pull_id,counts,created_at", order: "created_at.asc" }), select("pull_tasks", { select: "pull_id,profile_id,zip_group,market_fips" }),
    select("profiles", { select: "profile_id,rung,name,priority,doors_per_deal" }), select("zip_priorities", { select: "zip,zip_group,rating,doors_per_deal" }),
    select("markets", {}), select("ghl_contacts", { dnd: "eq.true", select: "contact_id" }), select("review_cases", { status: "eq.open", select: "case_id" })]);
  const t = new Map(tasks.map((x: any) => [x.pull_id, x])); const p = new Map(profiles.map((x: any) => [x.profile_id, x]));
  const zg = new Map(zips.map((z: any) => [z.zip, z]));
  const sum = (k: string) => batches.reduce((s: number, b: any) => s + (b.counts?.[k] || 0), 0);
  const byProf = new Map<string, any>(); const byZip = new Map<string, number>();
  for (const b of batches) {
    const task: any = t.get(b.pull_id) || {}; const key = task.profile_id || "(no list / test)";
    const r = byProf.get(key) || { pulls: 0, props: 0, fresh: 0, imp: 0, review: 0, held: 0 };
    r.pulls++; r.props += b.counts.unique_properties || 0; r.fresh += b.counts.net_new_properties || 0; r.imp += b.counts.import_rows || 0; r.review += b.counts.multi_property_review || 0; r.held += b.counts.held_propstream_dnc || 0;
    byProf.set(key, r);
    for (const [z, c] of Object.entries(b.counts.zip_distribution || {})) byZip.set(z, (byZip.get(z) || 0) + (c as number));
  }
  const city = markets.find((m: any) => m.fips === "29510");
  return (<>
    <Nav on="Tracker" />
    <h1>Tracker</h1>
    <p className="sub">Everything we have pulled, and later what it turned into in GHL.</p>
    <div className="grid">
      <div className="stat"><div className="big">{n(sum("unique_properties"))}</div><div className="muted">properties pulled</div></div>
      <div className="stat"><div className="big">{n(sum("net_new_properties"))}</div><div className="muted">net new properties</div></div>
      <div className="stat"><div className="big">{n(sum("import_rows"))}</div><div className="muted">contacts ready for GHL</div></div>
      <div className="stat"><div className="big">{n(sum("already_in_ghl"))}</div><div className="muted">numbers already in GHL</div></div>
      <div className="stat"><div className="big">{n(reviewOpen.length)}</div><div className="muted">open review cases</div></div>
      <div className="stat"><div className="big">{n(sum("held_propstream_dnc"))}</div><div className="muted">held (PropStream DNC)</div></div>
    </div>
    <h2>Results from GHL</h2>
    <div className="card"><div className="row"><div>
      <div><b>Replies, qualified leads, contracts, closed deals and doors per deal</b> will show here per list and ZIP.</div>
      <div className="muted">This switches on once imported contacts carry their DS Pull ID in GHL (step 2) and the results sync is connected (step 3).</div>
      <div className="muted" style={{ marginTop: 8 }}>{city?.notes} · {n(ghlDnd.length)} contacts are DND in GHL.</div></div>
      <SyncButton /></div></div>
    <h2>By list</h2>
    <div className="tablewrap"><table><thead><tr><th>List</th><th>DataSift doors/deal</th><th>Pulls</th><th>Properties</th><th>Net new</th><th>Import rows</th><th>Review</th><th>Held DNC</th><th>Our doors/deal</th></tr></thead><tbody>
      {Array.from(byProf.entries()).map(([k, r]) => { const pr: any = p.get(k); return (<tr key={k}><td>{pr ? `#${pr.rung} ${pr.name}` : k}</td><td>{pr?.doors_per_deal ?? ""}</td>
        <td>{r.pulls}</td><td>{n(r.props)}</td><td>{n(r.fresh)}</td><td>{n(r.imp)}</td><td>{n(r.review)}</td><td>{n(r.held)}</td><td className="muted">pending</td></tr>); })}
      {!byProf.size && <tr><td colSpan={9} className="muted">No pulls processed yet.</td></tr>}
    </tbody></table></div>
    <h2>By ZIP</h2>
    <div className="tablewrap"><table><thead><tr><th>ZIP</th><th>Group</th><th>DataSift rating</th><th>DataSift doors/deal</th><th>Properties pulled</th><th>Our doors/deal</th></tr></thead><tbody>
      {Array.from(byZip.entries()).sort((a, b) => b[1] - a[1]).map(([z, c]) => { const zz: any = zg.get(z) || {}; return (<tr key={z}><td>{z}</td><td>{zz.zip_group || "outside City list"}</td>
        <td>{zz.rating ?? ""}</td><td>{zz.doors_per_deal ?? ""}</td><td>{n(c)}</td><td className="muted">pending</td></tr>); })}
    </tbody></table></div>
  </>);
}
