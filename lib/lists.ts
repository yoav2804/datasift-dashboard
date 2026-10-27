// Shared data for the Calendar and List Log pages: every list, every time it was pulled, and whether it is time to pull it again.
import { select } from "./sb";

export const TZ = "Asia/Jerusalem";
export const dayOf = (d: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(typeof d === "string" ? new Date(d) : d);
export const today = () => dayOf(new Date());
const D = (s: string) => new Date(s + "T12:00:00Z");
export const addDays = (s: string, n: number) => new Date(D(s).getTime() + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((D(b).getTime() - D(a).getTime()) / 864e5);
export const weekStart = (s: string) => addDays(s, -D(s).getUTCDay());   // weeks run Sunday to Saturday
export const fmt = (s: string, o: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) => D(s).toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
export const fmtLong = (s: string) => fmt(s, { month: "short", day: "numeric", year: "numeric" });
export const ago = (s: string, t = today()) => { const n = daysBetween(s, t); return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`; };
export const marketShort = (f: string) => (f === "29189" ? "County" : f === "29510" ? "City" : f);

export type Pull = { date: string; pullId: string; file: string; rows: number; newProps: number | null; pctNewToList: number | null; importRows: number | null; files?: { results: string; import_csv: string } };
export type ListInfo = {
  key: string; profile: any; market: string; zipGroup: string; zips: string[] | null;
  pulls: Pull[]; last: Pull | null; next: any | null; nextDate: string | null;
  state: "ready" | "waiting" | "never" | "none"; stateText: string; daysLeft: number;
};

export async function loadLists() {
  const [tasks, profiles, uploads, markets] = await Promise.all([
    select("pull_tasks", { order: "planned_date.asc,pull_id.asc" }), select("profiles", {}),
    select("uploads", { order: "uploaded_at.desc", select: "upload_id,pull_id,filename,uploaded_at,row_count,report" }), select("markets", {})]);
  const prof = new Map<string, any>(profiles.map((p: any) => [p.profile_id, p]));
  const taskById = new Map<string, any>(tasks.map((t: any) => [t.pull_id, t]));
  const t0 = today();
  const keyOf = (t: any) => `${t.profile_id}|${t.zip_group || "ALL"}`;
  const lists = new Map<string, ListInfo>();
  const get = (t: any): ListInfo | null => {
    if (!t?.profile_id || !prof.has(t.profile_id)) return null;
    const k = keyOf(t);
    if (!lists.has(k)) lists.set(k, { key: k, profile: prof.get(t.profile_id), market: t.market_fips, zipGroup: t.zip_group || "ALL", zips: t.zips,
      pulls: [], last: null, next: null, nextDate: null, state: "none", stateText: "", daysLeft: 0 });
    return lists.get(k)!;
  };
  for (const t of tasks) get(t);
  // a pull counts once it was processed successfully
  for (const u of uploads) {
    if (!u.report?.files) continue;
    const L = get(taskById.get(u.pull_id)); if (!L) continue;
    L.pulls.push({ date: dayOf(u.uploaded_at), pullId: u.pull_id, file: decodeURIComponent(String(u.filename || "").replace(/\+/g, " ")), rows: u.row_count,
      newProps: u.report.net_new_properties ?? null, pctNewToList: u.report.pct_new_to_list ?? null, importRows: u.report.import_rows ?? null, files: u.report.files });
  }
  lists.forEach((L) => {
    L.pulls.sort((a, b) => b.date.localeCompare(a.date));
    L.last = L.pulls[0] || null;
    L.next = tasks.find((t: any) => keyOf(t) === L.key && t.status === "planned") || null;
    L.nextDate = L.next?.planned_date || null;
    if (!L.nextDate) { L.state = "none"; L.stateText = "Not scheduled"; return; }
    L.daysLeft = daysBetween(t0, L.nextDate);
    if (L.daysLeft <= 0) { L.state = L.last ? "ready" : "never"; L.stateText = L.last ? "Ready to pull again" : "Ready, never pulled"; if (L.daysLeft < -7) L.stateText += ` (${-L.daysLeft} days late)`; }
    else { L.state = L.last ? "waiting" : "never"; L.stateText = L.last ? `Wait ${L.daysLeft} day${L.daysLeft === 1 ? "" : "s"}` : `Starts in ${L.daysLeft} day${L.daysLeft === 1 ? "" : "s"}`; }
  });
  return { tasks, profiles, prof, uploads, markets, lists, listOf: (t: any) => lists.get(keyOf(t)) || null };
}
