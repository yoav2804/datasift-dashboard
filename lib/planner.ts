// Weekly pull planner: recommends which lists to pull this week to fill our outreach capacity.
// Capacity is counted in PROPERTIES (one new outreach message per property, to its primary number).
// Rules, in order:
//   1. Lists never pulled come before lists that are only due for recycling (whatever their DataSift priority).
//   2. Inside each group: DataSift priority, then doors per deal (cheapest first).
//   3. Markets are balanced: the next pick always goes to the market with the fewest planned properties so far,
//      so a week is never all one market just because its lists rank higher.
//   4. Recycled lists are only eligible once their learned refresh date has come.
//   5. Estimates come from history and get replaced by actual numbers as files are uploaded during the week.
import { select } from "./sb";
import { loadLists, addDays, today, weekStart, daysBetween, marketShort } from "./lists";

export type Settings = { daily_capacity: number; working_days: number };
export const DEFAULT_SETTINGS: Settings = { daily_capacity: 1000, working_days: 6 };
const DEFAULT_REFRESH = 0.25;
// properties that went to outreach with only new numbers. Older uploads also exported duplicates, so use their "new" count.
const exported = (r: any) => (r?.unique_phone_numbers != null ? r.import_rows : r?.import_rows_new ?? r?.import_rows) || 0;   // share of a list assumed new on a re-pull when we have no measurement yet

export async function getSettings(): Promise<Settings> {
  const rows = await select("app_settings", { key: "eq.planner" }).catch(() => []);
  return { ...DEFAULT_SETTINGS, ...(rows[0]?.value || {}) };
}

export type Rec = {
  key: string; profileId: string; sourceId: string; name: string; market: string; zipGroup: string; zips: string[] | null; priority: number; dpd: number | null; rung: number | null;
  kind: "never" | "recycle"; est: number; estHow: string; lastPulled: string | null; dueDate: string | null;
  plannedTask: any | null;   // an existing planned pull for this list, if any
};

export async function computePlan(weekOf?: string) {
  const ws = weekStart(weekOf || today()), we = addDays(ws, 6), t0 = today();
  const [settings, { tasks, profiles, prof, uploads, lists }] = await Promise.all([getSettings(), loadLists()]);
  const capacity = settings.daily_capacity * settings.working_days;

  // history: how many properties end up in the outreach export per row pulled, per market
  const taskOf = new Map(tasks.map((t: any) => [t.pull_id, t]));
  const yieldBy = new Map<string, { rows: number; exp: number }>();
  for (const u of uploads as any[]) {
    if (u.status !== "confirmed" || !u.report?.files) continue; const t: any = taskOf.get(u.pull_id); if (!t) continue;
    const y = yieldBy.get(t.market_fips) || { rows: 0, exp: 0 }; y.rows += u.report.rows_in_file || 0; y.exp += exported(u.report); yieldBy.set(t.market_fips, y);
  }
  const allY = Array.from(yieldBy.values()).reduce((a, y) => ({ rows: a.rows + y.rows, exp: a.exp + y.exp }), { rows: 0, exp: 0 });
  const marketYield = (m: string) => { const y = yieldBy.get(m); return y && y.rows > 500 ? y.exp / y.rows : allY.rows ? allY.exp / allY.rows : 0.5; };

  // used this week: properties actually exported (confirmed or waiting as a draft) from uploads made this week
  let used = 0; const usedBy: Record<string, number> = {}; const pulledThisWeek = new Set<string>();
  for (const u of uploads as any[]) {
    if (!["confirmed", "draft"].includes(u.status) || !u.report?.files) continue;
    const d = String(u.uploaded_at).slice(0, 10); if (d < ws || d > we) continue;
    const t: any = taskOf.get(u.pull_id); const n = exported(u.report); used += n;
    if (t) { usedBy[t.market_fips] = (usedBy[t.market_fips] || 0) + n; pulledThisWeek.add(`${t.profile_id}|${t.zip_group || "ALL"}`); }
  }

  // candidates: every pullable list (profile x ZIP group). Profiles never planned count as one all-ZIPs list.
  const groupsOf = new Map<string, Set<string>>();
  for (const t of tasks as any[]) if (t.profile_id) { if (!groupsOf.has(t.profile_id)) groupsOf.set(t.profile_id, new Set()); groupsOf.get(t.profile_id)!.add(t.zip_group || "ALL"); }
  const recs: Rec[] = [];
  for (const p of profiles as any[]) {
    if (!p.source_id) continue;                                   // PropStream can't pull it
    const groups = Array.from(groupsOf.get(p.profile_id) || new Set(["ALL"]));
    for (const g of groups) {
      const key = `${p.profile_id}|${g}`; if (pulledThisWeek.has(key)) continue;
      const L: any = lists.get(key);
      const sample = (tasks as any[]).find((t) => t.profile_id === p.profile_id && (t.zip_group || "ALL") === g);
      const planned = (tasks as any[]).filter((t) => t.profile_id === p.profile_id && (t.zip_group || "ALL") === g && t.status === "planned").sort((a, b) => (a.planned_date || "9").localeCompare(b.planned_date || "9"))[0] || null;
      const share = groups.length > 1 ? 1 / groups.length : 1;     // a ZIP group is roughly an equal slice of the list
      const base = { key, profileId: p.profile_id, sourceId: sample?.source_id || p.source_id, name: p.name, market: p.market_fips, zipGroup: g, zips: sample?.zips || null, priority: p.priority ?? 9, dpd: p.doors_per_deal ?? null, rung: p.rung ?? null, plannedTask: planned };
      if (!L?.last) {
        const rows = Math.round((p.list_size || 0) * share); const y = marketYield(p.market_fips);
        recs.push({ ...base, kind: "never", est: Math.round(rows * y), estHow: `${rows.toLocaleString()} on the DataSift list × ${Math.round(y * 100)}% that reach the export in ${marketShort(p.market_fips)}`, lastPulled: null, dueDate: null });
      } else {
        const last = L.last; const due = L.nextDate || null;
        if (due && due > we) continue;                                // not time to recycle yet
        const fresh = last.pctNewToList != null && L.pulls.length > 1 ? last.pctNewToList / 100 : DEFAULT_REFRESH;
        const lastUp: any = (uploads as any[]).find((u) => u.pull_id === last.pullId && u.status === "confirmed");
        const y = last.rows && lastUp ? exported(lastUp.report) / last.rows : marketYield(p.market_fips);
        const est = Math.round((last.rows || 0) * fresh * y);
        recs.push({ ...base, kind: "recycle", est, estHow: `${(last.rows || 0).toLocaleString()} rows last time × ${Math.round(fresh * 100)}% new${L.pulls.length > 1 ? "" : " (assumed, not measured yet)"} × ${Math.round(y * 100)}% to export`,
          lastPulled: last.date, dueDate: due });
      }
    }
  }

  // pick: never-pulled first, then recycled; markets balanced by planned properties
  const order = (a: Rec, b: Rec) => (a.kind === b.kind ? 0 : a.kind === "never" ? -1 : 1) || a.priority - b.priority || (a.dpd ?? 1e9) - (b.dpd ?? 1e9)
    || (a.lastPulled || "").localeCompare(b.lastPulled || "") || a.key.localeCompare(b.key);
  const queues = new Map<string, Rec[]>();
  for (const r of recs.filter((r) => r.est > 0).sort(order)) { if (!queues.has(r.market)) queues.set(r.market, []); queues.get(r.market)!.push(r); }
  const plannedBy: Record<string, number> = { ...usedBy }; const picks: Rec[] = []; let total = used;
  while (total < capacity) {
    const open = Array.from(queues.entries()).filter(([, q]) => q.length);
    if (!open.length) break;
    // the market with the fewest planned properties goes next; never-pulled lists anywhere still beat recycled ones
    const anyNever = open.some(([, q]) => q[0].kind === "never");
    const cand = open.filter(([, q]) => !anyNever || q[0].kind === "never").sort((a, b) => (plannedBy[a[0]] || 0) - (plannedBy[b[0]] || 0))[0];
    const r = cand[1].shift()!; picks.push(r); total += r.est; plannedBy[r.market] = (plannedBy[r.market] || 0) + r.est;
  }
  const notPicked = recs.filter((r) => !picks.includes(r)).sort(order);
  return { ws, we, t0, settings, capacity, used, usedBy, planned: total - used, remaining: Math.max(0, capacity - total), picks, notPicked,
    marketYield: Object.fromEntries(Array.from(yieldBy.keys()).map((m) => [m, marketYield(m)])), prof };
}

// pull id like the existing ones: P-<market>-R<rung>-<zip group>-<yyyymmdd>
export const pullIdFor = (r: { market: string; rung: number | null; profileId: string; zipGroup: string }, date: string) =>
  `P-${r.market}-R${r.rung != null ? String(r.rung).padStart(2, "0") : r.profileId.slice(-4)}-${r.zipGroup || "ALL"}-${date.replace(/-/g, "")}`;
export const plannedDateFor = (ws: string) => { const t0 = today(); return t0 >= ws && t0 <= addDays(ws, 6) ? t0 : ws; };
export { daysBetween };
