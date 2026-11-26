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
import { loadRecycling } from "./recycling";
import { loadZipCoverage, zipsOfList, needsCoverage, ZipCov } from "./zips";
export const SURPLUS = 1.15;   // plan ~15% over capacity: better a surplus than running out of new data mid-week

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
  covers: string[];          // target ZIPs needing coverage that this list reaches
  why: string[];             // plain reasons it was picked
};

export async function computePlan(weekOf?: string) {
  const ws = weekStart(weekOf || today()), we = addDays(ws, 6), t0 = today();
  const [settings, { tasks, profiles, prof, uploads, lists }, recycling, cov] = await Promise.all([getSettings(), loadLists(), loadRecycling(), loadZipCoverage(weekOf)]);
  const needZips = cov.zips.filter(needsCoverage);
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

  // estimate vs actual: pulls planned with an estimate that have since been uploaded and confirmed
  const upByPull = new Map((uploads as any[]).filter((u) => u.status === "confirmed" && u.report?.files).map((u) => [u.pull_id, u]));
  const checks = (tasks as any[]).filter((t) => t.est_export_doors > 0 && upByPull.has(t.pull_id))
    .map((t) => ({ pullId: t.pull_id, market: t.market_fips, profileId: t.profile_id, est: t.est_export_doors, actual: exported((upByPull.get(t.pull_id) as any).report), date: String((upByPull.get(t.pull_id) as any).uploaded_at).slice(0, 10) }));
  const calib = new Map<string, { f: number; n: number }>();
  for (const m of Array.from(new Set(checks.map((c) => c.market)))) { const cs = checks.filter((c) => c.market === m);
    if (cs.length >= 2) calib.set(m, { f: Math.min(2, Math.max(0.5, cs.reduce((s, c) => s + c.actual, 0) / cs.reduce((s, c) => s + c.est, 0))), n: cs.length }); }
  const adj = (m: string, v: number, how: string): [number, string] => { const c = calib.get(m); return c ? [Math.round(v * c.f), `${how}; × ${c.f.toFixed(2)} from ${c.n} past estimates in ${marketShort(m)}`] : [Math.round(v), how]; };

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
      const covers = zipsOfList(needZips, p.market_fips, g).map((z) => z.zip);
      const base = { key, profileId: p.profile_id, sourceId: sample?.source_id || p.source_id, name: p.name, market: p.market_fips, zipGroup: g, zips: sample?.zips || null, priority: p.priority ?? 9, dpd: p.doors_per_deal ?? null, rung: p.rung ?? null, plannedTask: planned, covers, why: [] as string[] };
      const R = recycling.get(key);
      if (!R && !L?.last) {
        const rows = Math.round((p.list_size || 0) * share); const y = marketYield(p.market_fips);
        const [est, estHow] = adj(p.market_fips, rows * y, `${rows.toLocaleString()} on the DataSift list × ${Math.round(y * 100)}% that reach outreach with new numbers in ${marketShort(p.market_fips)}`);
        recs.push({ ...base, kind: "never", est, estHow, lastPulled: null, dueDate: null });
      } else {
        // recycling date and refresh come from the list's own re-pulls (smart recycling)
        const lastDate = R?.lastDate || L.last.date, due = R?.nextDate || L?.nextDate || null;
        if (due && due > we) continue;                                // not time to recycle yet
        const elapsed = daysBetween(lastDate, addDays(ws, 3));
        const fresh = R?.learnedPerMonth != null ? Math.min(1, (R.learnedPerMonth * Math.max(elapsed, 30)) / 30) : DEFAULT_REFRESH;
        const rows = R?.lastRows || L?.last?.rows || 0, y = R?.lastYield ?? marketYield(p.market_fips);
        const [est, estHow] = adj(p.market_fips, rows * fresh * y, `${rows.toLocaleString()} rows last time × ${Math.round(fresh * 100)}% expected new after ${elapsed} days${R?.measured ? " (learned)" : " (assumed until the first re-pull measures it)"} × ${Math.round(y * 100)}% to outreach`);
        recs.push({ ...base, kind: "recycle", est, estHow, lastPulled: lastDate, dueDate: due });
      }
    }
  }

  // pick: never-pulled first, then recycled; markets balanced by planned properties
  const order = (a: Rec, b: Rec) => (a.kind === b.kind ? 0 : a.kind === "never" ? -1 : 1) || a.priority - b.priority
    || (b.covers.length > 0 ? 1 : 0) - (a.covers.length > 0 ? 1 : 0) || (a.dpd ?? 1e9) - (b.dpd ?? 1e9)
    || (a.lastPulled || "").localeCompare(b.lastPulled || "") || a.key.localeCompare(b.key);
  const queues = new Map<string, Rec[]>();
  for (const r of recs.filter((r) => r.est > 0).sort(order)) { if (!queues.has(r.market)) queues.set(r.market, []); queues.get(r.market)!.push(r); }
  const plannedBy: Record<string, number> = { ...usedBy }; const picks: Rec[] = []; let total = used;
  const target = Math.round(capacity * SURPLUS);
  while (total < target) {
    const open = Array.from(queues.entries()).filter(([, q]) => q.length);
    if (!open.length) break;
    // the market with the fewest planned properties goes next; never-pulled lists anywhere still beat recycled ones
    const anyNever = open.some(([, q]) => q[0].kind === "never");
    const cand = open.filter(([, q]) => !anyNever || q[0].kind === "never").sort((a, b) => (plannedBy[a[0]] || 0) - (plannedBy[b[0]] || 0))[0];
    const r = cand[1].shift()!; picks.push(r); total += r.est; plannedBy[r.market] = (plannedBy[r.market] || 0) + r.est;
    r.why.push(r.kind === "never" ? "never pulled" : "recycle due", `fills ${marketShort(r.market)}`);
  }
  // ZIP coverage: a target ZIP left uncovered gets the best eligible list that reaches it, even past the target
  const coveredBy = (zip: string) => picks.some((r) => r.covers.includes(zip));
  for (const z of needZips) {
    if (coveredBy(z.zip)) continue;
    const q = queues.get(z.market) || []; const i = q.findIndex((r) => r.covers.includes(z.zip));
    if (i >= 0) { const r = q.splice(i, 1)[0]; picks.push(r); total += r.est; plannedBy[r.market] = (plannedBy[r.market] || 0) + r.est; r.why.push(`covers ZIP ${z.zip} (${z.statusText.toLowerCase()})`); }
  }
  picks.forEach((r) => { const c = r.covers.filter((x) => !r.why.some((w) => w.includes(x))); if (c.length && !r.why.some((w) => w.startsWith("covers"))) r.why.push(`reaches ${c.length} ZIP${c.length === 1 ? "" : "s"} needing coverage`); });
  // ZIPs still not covered this week, and why
  const allByZip = (z: ZipCov) => recs.filter((r) => r.market === z.market && (r.zipGroup === "ALL" || r.zipGroup === z.group));
  const uncovered = needZips.filter((z) => !coveredBy(z.zip)).map((z) => {
    const waiting = (tasks as any[]).filter((t) => t.market_fips === z.market && t.profile_id && (t.zip_group === "ALL" || t.zip_group === z.group)).length;
    const why = allByZip(z).length ? "lists covering it were not needed this week" : waiting ? "every list covering it is waiting for its recycle date" : "no pullable list covers this ZIP";
    return { ...z, why };
  });
  const notPicked = recs.filter((r) => !picks.includes(r)).sort(order);
  return { ws, we, t0, settings, capacity, target, used, usedBy, planned: total - used, remaining: Math.max(0, capacity - total), picks, notPicked, checks, calib: Object.fromEntries(calib), zips: cov.zips, uncovered,
    marketYield: Object.fromEntries(Array.from(yieldBy.keys()).map((m) => [m, marketYield(m)])), prof };
}

// pull id like the existing ones: P-<market>-R<rung>-<zip group>-<yyyymmdd>
export const pullIdFor = (r: { market: string; rung: number | null; profileId: string; zipGroup: string }, date: string) =>
  `P-${r.market}-R${r.rung != null ? String(r.rung).padStart(2, "0") : r.profileId.slice(-4)}-${r.zipGroup || "ALL"}-${date.replace(/-/g, "")}`;
export const plannedDateFor = (ws: string) => { const t0 = today(); return t0 >= ws && t0 <= addDays(ws, 6) ? t0 : ws; };
export { daysBetween };
