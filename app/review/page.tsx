import Nav from "../nav";
import { select } from "@/lib/sb";
import { marketShort } from "@/lib/lists";
export const dynamic = "force-dynamic";

// Shared numbers: phone numbers linked to more than one property. Logged automatically, no manual decisions.
// Same owner = legitimate multi-property ownership. Different owner = the number may be wrong for one of the properties.
const WHY: any = { in_ghl_other_property: "In GHL on another property", shared_in_history: "Linked before to another property", shared_in_batch: "On 2+ properties in the same file" };
const REL: any = { same_owner: "Same owner", different_owner: "Different owner", unknown: "Unknown" };
const RELS = ["same_owner", "different_owner", "unknown"];
const PAGE = 100;
const n = (v: number) => v.toLocaleString();
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "–");

export default async function Review({ searchParams }: { searchParams: { rel?: string; page?: string } }) {
  const rel = RELS.includes(searchParams.rel || "") ? searchParams.rel! : "different_owner";
  const page = Math.max(1, parseInt(searchParams.page || "1") || 1);
  const [all, tasks, profiles] = await Promise.all([
    select("review_cases", { status: "neq.voided", select: "reason,owner_relation,pull_id,phone" }),
    select("pull_tasks", { select: "pull_id,profile_id,market_fips,zip_group" }), select("profiles", { select: "profile_id,name" })]);
  const rows = await select("review_cases", { status: "neq.voided", owner_relation: `eq.${rel}`, order: "created_at.desc", limit: String(PAGE), offset: String((page - 1) * PAGE),
    select: "case_id,phone,reason,pull_id,notes,owner_name_match,mailing_match,ghl_contact_id,prop:properties!review_cases_new_property_id_fkey(address,city,zip)" });
  const tk = new Map(tasks.map((t: any) => [t.pull_id, t])); const pf = new Map(profiles.map((p: any) => [p.profile_id, p.name]));
  const listOf = (pullId: string) => { const t: any = tk.get(pullId); if (!t) return pullId;
    return `${pf.get(t.profile_id) || "no list"} (${marketShort(t.market_fips)})${t.zip_group && t.zip_group !== "ALL" ? ` · ZIP group ${t.zip_group}` : ""}`; };
  const relOf = (c: any) => c.owner_relation || "unknown";

  // totals by owner relation and by reason (unique numbers)
  const uniq = (f: (c: any) => boolean) => new Set(all.filter(f).map((c: any) => c.phone)).size;
  const total = uniq(() => true);
  const byReason = Object.keys(WHY).map((r) => [r, ...RELS.map((x) => uniq((c) => c.reason === r && relOf(c) === x))] as [string, ...number[]]);
  // by list
  const lists = new Map<string, any>();
  for (const c of all as any[]) { const k = listOf(c.pull_id); const L = lists.get(k) || { all: new Set(), same_owner: new Set(), different_owner: new Set(), unknown: new Set() };
    L.all.add(c.phone); L[relOf(c)].add(c.phone); lists.set(k, L); }
  const listRows = Array.from(lists.entries()).sort((a, b) => b[1].different_owner.size - a[1].different_owner.size);
  const relCount = (x: string) => all.filter((c: any) => relOf(c) === x).length;
  const pages = Math.max(1, Math.ceil(relCount(rel) / PAGE));
  const loc = process.env.GHL_LOCATION_ID;

  return (<>
    <Nav on="Shared numbers" />
    <h1>Shared numbers</h1>
    <p className="sub">Phone numbers linked to more than one property. Nothing to decide here: each one is logged automatically. A number that already entered texting is left out of new exports, and a number repeated in the same file is sent once.
      <b> Same owner</b> means one owner with several properties, which is normal. <b>Different owner</b> means the number may be wrong for one of the properties.</p>
    <div className="grid">
      <div className="stat"><div className="big">{n(total)}</div><div className="muted">shared numbers</div></div>
      <div className="stat"><div className="big">{pct(uniq((c) => relOf(c) === "same_owner"), total)}</div><div className="muted">same owner (multi-property)</div></div>
      <div className="stat"><div className="big">{pct(uniq((c) => relOf(c) === "different_owner"), total)}</div><div className="muted">different owner (possibly wrong)</div></div>
      <div className="stat"><div className="big">{pct(uniq((c) => relOf(c) === "unknown"), total)}</div><div className="muted">unknown</div></div>
    </div>

    <h2>Why they are shared</h2>
    <div className="tablewrap"><table><thead><tr><th>Reason</th><th>Same owner</th><th>Different owner</th><th>Unknown</th></tr></thead><tbody>
      {byReason.map(([r, s, d, u]) => <tr key={r}><td>{WHY[r]}</td><td>{n(s as number)}</td><td><b>{n(d as number)}</b></td><td>{n(u as number)}</td></tr>)}
    </tbody></table></div>

    <h2>By list</h2>
    <div className="tablewrap"><table><thead><tr><th>List</th><th>Shared numbers</th><th>Same owner</th><th>Different owner</th><th>% different owner</th></tr></thead><tbody>
      {listRows.map(([k, L]) => <tr key={k}><td>{k}</td><td>{n(L.all.size)}</td><td>{n(L.same_owner.size)}</td><td>{n(L.different_owner.size)}</td><td><b>{pct(L.different_owner.size, L.all.size)}</b></td></tr>)}
      {!listRows.length && <tr><td colSpan={5} className="muted">Nothing yet.</td></tr>}
    </tbody></table></div>

    <h2>Numbers</h2>
    <p>{RELS.map((x) => <a key={x} href={`/review?rel=${x}`} className={`tag ${x === rel ? "ok" : ""}`}>{REL[x]} ({n(relCount(x))})</a>)}</p>
    <div className="tablewrap"><table><thead><tr><th>Number</th><th>This property</th><th>Other property</th><th>Why</th><th>Name / mailing</th><th>List</th></tr></thead><tbody>
      {rows.map((c: any) => <tr key={c.case_id}><td><b>{c.phone}</b>{c.ghl_contact_id && <div><a target="_blank" href={`https://app.gohighlevel.com/v2/location/${loc}/contacts/detail/${c.ghl_contact_id}`}>GHL ↗</a></div>}</td>
        <td>{c.prop?.address}, {c.prop?.city} {c.prop?.zip}</td><td>{(c.notes || "").replace(/^Other property: /, "")}</td><td>{WHY[c.reason]}</td>
        <td>{c.owner_name_match === true ? "same name" : c.owner_name_match === false ? "different name" : "–"} · {c.mailing_match === true ? "same mailing" : c.mailing_match === false ? "different mailing" : "–"}</td>
        <td className="muted">{listOf(c.pull_id)}</td></tr>)}
      {!rows.length && <tr><td colSpan={6} className="muted">None.</td></tr>}
    </tbody></table></div>
    {pages > 1 && <p>Page {page} of {pages} · {page > 1 && <a href={`/review?rel=${rel}&page=${page - 1}`}>‹ Previous</a>} {page < pages && <a href={`/review?rel=${rel}&page=${page + 1}`}>Next ›</a>}</p>}
  </>);
}
