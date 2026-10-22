import Nav from "../nav";
import { select } from "@/lib/sb";
import Decide from "./decide";
export const dynamic = "force-dynamic";
const WHY: any = { in_ghl_other_property: "Already in GHL on a different property", shared_in_history: "Seen before on a different property", shared_in_batch: "Same number on 2+ properties in one file" };
export default async function Review({ searchParams }: { searchParams: { show?: string } }) {
  const show = searchParams.show === "done" ? "done" : "open";
  const cases = await select("review_cases", { status: show === "open" ? "eq.open" : "neq.open", order: "created_at.desc",
    select: "*,prop:properties!review_cases_new_property_id_fkey(address,city,zip)" });
  const ids = Array.from(new Set(cases.map((c: any) => c.ghl_contact_id).filter(Boolean)));
  const gc = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 100) for (const g of await select("ghl_contacts", { contact_id: `in.(${ids.slice(i, i + 100).join(",")})`, select: "contact_id,name,dnd,date_added" })) gc.set(g.contact_id, g);
  cases.forEach((c: any) => (c.ghl = gc.get(c.ghl_contact_id)));
  const loc = process.env.GHL_LOCATION_ID;
  return (<>
    <Nav on="Review" />
    <h1>Multi-Property Review</h1>
    <p className="sub">These numbers were held back from the import because they connect to another property. Decide each one. Your choice is recorded here only; nothing changes in GHL.</p>
    <p><a href="/review" className={`tag ${show === "open" ? "ok" : ""}`}>Open</a><a href="/review?show=done" className={`tag ${show === "done" ? "ok" : ""}`}>Decided</a></p>
    {!cases.length && <div className="card muted">Nothing here.</div>}
    {cases.map((c: any) => (<div className="card" key={c.case_id}><div className="row"><div>
      <div style={{ fontWeight: 700 }}>{c.phone}</div>
      <div className="muted">{WHY[c.reason]}</div>
      <div style={{ marginTop: 8 }}>This property: <b>{c.prop?.address}, {c.prop?.city} {c.prop?.zip}</b></div>
      {c.notes && <div>{c.notes}</div>}
      <div style={{ marginTop: 6 }}>
        {c.owner_name_match === true && <span className="tag ok">same owner last name</span>}
        {c.owner_name_match === false && <span className="tag warn">different owner name</span>}
        {c.mailing_match === true && <span className="tag ok">same mailing address</span>}
        {c.mailing_match === false && <span className="tag warn">different mailing address</span>}
        {c.ghl && <span className="tag">GHL: {c.ghl.name}{c.ghl.dnd ? " · DND" : ""} · since {(c.ghl.date_added || "").slice(0, 10)}</span>}
      </div>
      {c.ghl_contact_id && <div style={{ marginTop: 6 }}><a target="_blank" href={`https://app.gohighlevel.com/v2/location/${loc}/contacts/detail/${c.ghl_contact_id}`}>Open contact in GHL ↗</a></div>}
      <div className="muted" style={{ marginTop: 6 }}><code>{c.pull_id}</code></div>
    </div><Decide id={c.case_id} status={c.status} /></div></div>))}
  </>);
}
