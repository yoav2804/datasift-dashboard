import Nav from "../nav";
import { select } from "@/lib/sb";
import Uploader from "./uploader";
import DraftActions, { Reprocess } from "./draftactions";
import { marketShort } from "@/lib/lists";
export const dynamic = "force-dynamic";

const dl = (p: string) => `/api/download?path=${encodeURIComponent(p)}`;
const when = (s?: string) => (s ? new Date(s).toLocaleString("en-GB", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

export default async function Upload({ searchParams }: { searchParams: { pull?: string } }) {
  const [tasks, allTasks, profiles, uploads, sources] = await Promise.all([
    select("pull_tasks", { order: "planned_date.asc,pull_id.asc", status: "eq.planned" }),
    select("pull_tasks", { select: "pull_id,profile_id,market_fips,zip_group,source_id" }),
    select("profiles", { select: "profile_id,rung,name,source_id" }),
    select("uploads", { order: "uploaded_at.desc", select: "upload_id,pull_id,filename,uploaded_at,row_count,report,status,storage_path,voided_at,void_reason,confirmed_at,skip_trace_provider,original_source_id" }),
    select("sources", { select: "source_id,name,kind,market_fips", order: "kind.asc,name.asc" })]);
  const srcName = new Map(sources.map((s: any) => [s.source_id, s.name]));
  const origin = (u: any) => `${srcName.get(u.original_source_id) || u.original_source_id || "?"} · skip trace: ${u.skip_trace_provider || "?"}`;
  const prof = new Map(profiles.map((p: any) => [p.profile_id, p]));
  const taskOf = new Map(allTasks.map((t: any) => [t.pull_id, t]));
  const label = (t: any, withDate = true) => { const p: any = prof.get(t?.profile_id) || {};
    return `${withDate && t.planned_date ? t.planned_date + " · " : ""}${marketShort(t?.market_fips)} · ${p.name || "no list"} · ${!t?.zip_group || t.zip_group === "ALL" ? "all ZIPs" : "ZIP group " + t.zip_group}`; };
  const pullLabel = (id: string) => (taskOf.has(id) ? label(taskOf.get(id), false) : id);
  const opts = tasks.map((t: any) => ({ id: t.pull_id, label: label(t) }));
  const pullSource: Record<string, string> = Object.fromEntries(tasks.map((t: any) => [t.pull_id, t.source_id || (prof.get(t.profile_id) as any)?.source_id || "PROPSTREAM"]));
  const srcOpts = sources.map((s: any) => ({ id: s.source_id, name: s.name }));
  const drafts = uploads.filter((u: any) => u.status === "draft" && u.report?.files);
  const voided = uploads.filter((u: any) => u.status === "voided").slice(0, 15);
  const done = uploads.filter((u: any) => u.status === "confirmed" && u.report?.files);

  return (<>
    <Nav on="Upload" />
    <h1>Upload a pull</h1>
    <p className="sub">Pick the pull, choose the PropStream export, and you get a draft with the cleaned lists. Check it, then confirm the export to unlock the GHL import file. Wrong list? Undo it and process it again. Nothing is sent to GHL.</p>
    <Uploader options={opts} preset={searchParams.pull || ""} sources={srcOpts} pullSource={pullSource} />

    <h2 id="drafts">Drafts waiting for you</h2>
    {!drafts.length && <p className="muted">No drafts. Every processed upload has been confirmed or undone.</p>}
    {drafts.map((u: any) => { const r = u.report;
      return (<div className="card" key={u.upload_id}>
        <div style={{ fontWeight: 700 }}>{pullLabel(u.pull_id)}</div>
        <div className="muted">{u.filename} · uploaded {when(u.uploaded_at)} · <code>{u.pull_id}</code></div>
        <div className="muted">Source: {origin(u)}</div>
        <div style={{ marginTop: 6 }}>{r.rows_in_file?.toLocaleString()} rows · {r.net_new_properties?.toLocaleString()} new properties · {r.import_rows?.toLocaleString()} import rows · {r.multi_property_review?.toLocaleString()} to review{r.pct_new_to_list != null && r.refresh_note ? ` · ${r.pct_new_to_list}% new to this list` : ""}</div>
        {r.warnings?.length > 0 && <div className="err" style={{ marginTop: 10 }}><b>Check this before confirming:</b><ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>{r.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul></div>}
        <div style={{ marginTop: 12 }}><DraftActions uploadId={u.upload_id} results={r.files.results} warn={r.warnings?.length > 0} /></div>
      </div>); })}

    {voided.length > 0 && <><h2 id="voided">Undone</h2>
      <p className="sub">These don't count anywhere. Their rows are kept, marked as voided. You can process the same file again under the right pull.</p>
      {voided.map((u: any) => (<div className="card" key={u.upload_id}><div className="row"><div style={{ flex: 1, minWidth: 260 }}>
        <div><b>{u.filename}</b> <span className="tag">undone {when(u.voided_at)}</span></div>
        <div className="muted">was under {pullLabel(u.pull_id)} · <code>{u.pull_id}</code>{u.void_reason ? ` · ${u.void_reason}` : ""}</div></div>
        <div style={{ flex: 1, minWidth: 280 }}>{u.storage_path ? <Reprocess path={u.storage_path} filename={u.filename} options={opts} skipTrace={u.skip_trace_provider} sourceId={u.original_source_id} /> : <span className="muted">Original file not stored. Upload it again above.</span>}</div>
      </div></div>))}</>}

    <h2 id="done">Confirmed exports</h2>
    <div className="tablewrap"><table><thead><tr><th>When</th><th>Pull</th><th>Source · skip trace</th><th>File</th><th>Rows</th><th>New props</th><th>Import rows</th><th>Review</th><th>Files</th></tr></thead><tbody>
      {done.map((u: any) => <tr key={u.upload_id}><td>{when(u.uploaded_at)}</td><td>{pullLabel(u.pull_id)}<div className="muted"><code>{u.pull_id}</code></div></td><td>{origin(u)}</td><td>{u.filename}</td>
        <td>{u.row_count}</td><td>{u.report.net_new_properties}</td><td>{u.report.import_rows}</td><td>{u.report.multi_property_review}</td>
        <td><a href={dl(u.report.files.results)}>Results</a> · <a href={dl(u.report.files.import_csv)}>GHL CSV</a></td></tr>)}
      {!done.length && <tr><td colSpan={9} className="muted">None yet.</td></tr>}
    </tbody></table></div>
  </>);
}
