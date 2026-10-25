import Nav from "../nav";
import { select } from "@/lib/sb";
import SyncButton from "./sync";
export const dynamic = "force-dynamic";

const n = (v: any) => (v ?? 0).toLocaleString();
const STEPS = ["contacted", "replied", "interested", "qualified", "wrong_number", "opt_out", "contract", "closed"];
type Row = { sent: Set<string>; ev: Record<string, Set<string>> };
const blank = (): Row => ({ sent: new Set(), ev: Object.fromEntries(STEPS.map((s) => [s, new Set<string>()])) });
const per = (doors: number, hits: number) => (hits ? Math.round(doors / hits).toLocaleString() : "–");
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "–");

function Table({ title, rows, label, extra }: { title: string; rows: [string, Row][]; label: string; extra?: (k: string) => any }) {
  return (<><h2>{title}</h2>
    <div className="tablewrap"><table><thead><tr><th>{label}</th>{extra && <th>DataSift doors/deal</th>}<th>Sent to GHL</th><th>Texted</th><th>Replied</th><th>Leads</th>
      <th>Leads per 100 texted</th><th>Doors per lead</th><th>Contracts</th><th>Doors per contract</th><th>Closed</th><th>Doors per deal</th><th>Wrong #</th><th>Wrong # % of texted</th><th>Wrong # % of replies</th><th>Opt outs</th></tr></thead><tbody>
      {rows.map(([k, r]) => { const t = r.ev.contacted.size, q = r.ev.qualified.size;
        return (<tr key={k}><td>{k}{t > 0 && t < 300 && <span className="tag warn" style={{ marginLeft: 6 }}>small sample</span>}</td>{extra && <td>{extra(k)}</td>}
          <td>{n(r.sent.size)}</td><td>{n(t)}</td><td>{n(r.ev.replied.size)} <span className="muted">{pct(r.ev.replied.size, t)}</span></td><td><b>{n(q)}</b></td>
          <td><b>{t ? ((q / t) * 100).toFixed(2) : "–"}</b></td><td>{per(t, q)}</td><td>{n(r.ev.contract.size)}</td><td>{per(t, r.ev.contract.size)}</td>
          <td>{n(r.ev.closed.size)}</td><td>{per(t, r.ev.closed.size)}</td><td>{n(r.ev.wrong_number.size)}</td><td><b>{pct(r.ev.wrong_number.size, t)}</b></td><td>{pct(r.ev.wrong_number.size, r.ev.replied.size)}</td><td>{n(r.ev.opt_out.size)}</td></tr>); })}
      {!rows.length && <tr><td colSpan={16} className="muted">Nothing yet. Numbers appear after your first upload is imported into GHL and texting starts.</td></tr>}
    </tbody></table></div></>);
}

export default async function Tracker() {
  const [exported, batches, tasks, profiles, zips, markets, outcomes] = await Promise.all([
    select("export_rows", { bucket: "eq.new", select: "property_id,batch_id" }), select("export_batches", { select: "batch_id,pull_id" }),
    select("pull_tasks", { select: "pull_id,profile_id,market_fips" }), select("profiles", { select: "profile_id,name,market_fips,doors_per_deal" }),
    select("zip_priorities", { select: "market_fips,zip,zip_group,doors_per_deal" }), select("markets", {}), select("outcomes", { select: "property_id,pull_id,event" })]);
  const bPull = new Map(batches.map((b: any) => [b.batch_id, b.pull_id]));
  const tk = new Map(tasks.map((t: any) => [t.pull_id, t])); const pf = new Map(profiles.map((p: any) => [p.profile_id, p]));
  const mk = new Map(markets.map((m: any) => [m.fips, m.name]));
  const pids = Array.from(new Set([...exported.map((e: any) => e.property_id), ...outcomes.map((o: any) => o.property_id)].filter(Boolean)));
  const prop = new Map<string, any>();
  for (let i = 0; i < pids.length; i += 150) for (const p of await select("properties", { property_id: `in.(${pids.slice(i, i + 150).join(",")})`, select: "property_id,zip,market_fips" })) prop.set(p.property_id, p);
  const zinfo = new Map(zips.map((z: any) => [`${z.market_fips}|${z.zip}`, z]));

  // primary attribution: the first pull that exported the property
  const firstPull = new Map<string, string>();
  for (const e of exported) { const pl = bPull.get(e.batch_id); if (pl && !firstPull.has(e.property_id)) firstPull.set(e.property_id, pl as string); }
  const all = blank(), byM = new Map<string, Row>(), byL = new Map<string, Row>(), byZ = new Map<string, Row>();
  const keys = (pid: string, pullId?: string) => {
    const p = prop.get(pid) || {}; const t: any = tk.get(pullId || firstPull.get(pid) || "") || {}; const pr: any = pf.get(t.profile_id);
    const m = mk.get(p.market_fips) || "Other";
    const z = zinfo.get(`${p.market_fips}|${p.zip}`);
    return { m, l: pr ? `${pr.name} (${m === "St. Louis County" ? "County" : m === "St. Louis City" ? "City" : m})` : "Test / no list", z: `${p.zip || "?"} · ${m === "St. Louis County" ? "County" : "City"}${z ? ` · group ${z.zip_group}` : ""}` };
  };
  const get = (map: Map<string, Row>, k: string) => { if (!map.has(k)) map.set(k, blank()); return map.get(k)!; };
  for (const e of exported) { const k = keys(e.property_id); for (const r of [all, get(byM, k.m), get(byL, k.l), get(byZ, k.z)]) r.sent.add(e.property_id); }
  for (const o of outcomes) { if (!o.property_id || !STEPS.includes(o.event)) continue; const k = keys(o.property_id, o.pull_id);
    for (const r of [all, get(byM, k.m), get(byL, k.l), get(byZ, k.z)]) r.ev[o.event].add(o.property_id); }
  const sort = (m: Map<string, Row>) => Array.from(m.entries()).sort((a, b) => b[1].ev.contacted.size - a[1].ev.contacted.size || b[1].sent.size - a[1].sent.size);
  const dsByList = new Map(profiles.map((p: any) => [`${p.name} (${p.market_fips === "29189" ? "County" : "City"})`, p.doors_per_deal]));
  const t = all.ev.contacted.size, q = all.ev.qualified.size;
  const city = markets.find((m: any) => m.fips === "29510");

  return (<>
    <Nav on="Tracker" />
    <h1>Tracker</h1>
    <p className="sub">Every number counts doors (properties), not people or messages. A lead is a seller who reached Qualified in GHL. Only contacts that came from a pull in this system are counted.</p>
    <div className="grid">
      <div className="stat"><div className="big">{n(all.sent.size)}</div><div className="muted">doors sent to GHL</div></div>
      <div className="stat"><div className="big">{n(t)}</div><div className="muted">doors texted</div></div>
      <div className="stat"><div className="big">{pct(all.ev.replied.size, t)}</div><div className="muted">reply rate</div></div>
      <div className="stat"><div className="big">{n(q)}</div><div className="muted">qualified leads</div></div>
      <div className="stat"><div className="big">{per(t, q)}</div><div className="muted">doors per lead</div></div>
      <div className="stat"><div className="big">{per(t, all.ev.contract.size)}</div><div className="muted">doors per contract</div></div>
      <div className="stat"><div className="big">{per(t, all.ev.closed.size)}</div><div className="muted">doors per deal</div></div>
    </div>
    <h2>Skip trace quality</h2>
    <div className="grid">
      <div className="stat"><div className="big">{n(all.ev.wrong_number.size)}</div><div className="muted">doors with a wrong number</div></div>
      <div className="stat"><div className="big">{pct(all.ev.wrong_number.size, t)}</div><div className="muted">wrong number rate (of texted doors)</div></div>
      <div className="stat"><div className="big">{pct(all.ev.wrong_number.size, all.ev.replied.size)}</div><div className="muted">of replies said wrong number</div></div>
    </div>
    <p className="muted" style={{ marginTop: 8 }}>Counted from the Wrong Number stage and the "wrong number" tag. A number that never replies is unknown, so the real wrong rate is likely higher than shown.</p>
    <div className="card" style={{ marginTop: 16 }}><div className="row"><div>
      <div><b>Contracts and closed deals</b> happen in TJ Capital, so they show once that account is connected (read only).</div>
      <div className="muted" style={{ marginTop: 6 }}>Results refresh every night. {city?.notes?.match(/Last GHL sync[^,]*/)?.[0] || ""}</div></div>
      <SyncButton /></div></div>
    <Table title="By market" rows={sort(byM)} label="Market" />
    <Table title="By list" rows={sort(byL)} label="List" extra={(k) => dsByList.get(k) ?? ""} />
    <Table title="By ZIP" rows={sort(byZ)} label="ZIP" />
  </>);
}
