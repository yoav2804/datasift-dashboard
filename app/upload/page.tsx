import Nav from "../nav";
import { select } from "@/lib/sb";
import Uploader from "./uploader";
export const dynamic = "force-dynamic";
export default async function Upload({ searchParams }: { searchParams: { pull?: string } }) {
  const [tasks, profiles, uploads] = await Promise.all([
    select("pull_tasks", { order: "planned_date.asc", status: "eq.planned" }), select("profiles", { select: "profile_id,rung,name" }),
    select("uploads", { order: "uploaded_at.desc", select: "upload_id,pull_id,filename,uploaded_at,row_count,report" })]);
  const prof = new Map(profiles.map((p: any) => [p.profile_id, p]));
  const opts = tasks.map((t: any) => { const p: any = prof.get(t.profile_id) || {}; return { id: t.pull_id, label: `${t.planned_date} · #${p.rung} ${p.name} · ${t.zip_group === "ALL" ? "all ZIPs" : "group " + t.zip_group}` }; });
  return (<>
    <Nav on="Upload" />
    <h1>Upload a pull</h1>
    <p className="sub">Pick the pull, choose the PropStream export, and you get back the cleaned lists and the GHL import file. Nothing is sent to GHL.</p>
    <Uploader options={opts} preset={searchParams.pull || ""} />
    <h2>Past uploads</h2>
    <div className="tablewrap"><table><thead><tr><th>When</th><th>Pull</th><th>File</th><th>Rows</th><th>New props</th><th>Import rows</th><th>Review</th><th>Files</th></tr></thead><tbody>
      {uploads.filter((u: any) => u.report?.files).map((u: any) => <tr key={u.upload_id}><td>{u.uploaded_at.slice(0, 10)}</td><td><code>{u.pull_id}</code></td><td>{u.filename}</td>
        <td>{u.row_count}</td><td>{u.report.net_new_properties}</td><td>{u.report.import_rows}</td><td>{u.report.multi_property_review}</td>
        <td><a href={`/api/download?path=${encodeURIComponent(u.report.files.results)}`}>Results</a> · <a href={`/api/download?path=${encodeURIComponent(u.report.files.import_csv)}`}>GHL CSV</a></td></tr>)}
    </tbody></table></div>
  </>);
}
