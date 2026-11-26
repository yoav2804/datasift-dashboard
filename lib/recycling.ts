// Smart recycling: how fast each list refreshes, learned from its own re-pulls, and when to pull it again.
//   refresh  = share of the new pull that was NOT on the previous pull (new data, even if the list kept its size)
//   growth   = change in list size between the two pulls (can be 0 while refresh is high)
//   per month = refresh scaled to 30 days (never scaled UP from a gap shorter than 30 days)
//   interval = 30 / 60 / 90 / 180 days from the learned monthly refresh
import { select } from "./sb";
import { addDays, dayOf } from "./lists";

export const NO_DATA_INTERVAL = 30;   // first re-pull after 30 days, to measure
export const intervalFor = (perMonth: number | null) => perMonth == null ? NO_DATA_INTERVAL : perMonth >= 0.5 ? 30 : perMonth >= 0.25 ? 60 : perMonth >= 0.1 ? 90 : 180;
export const perMonthOf = (refresh: number, days: number) => (refresh * 30) / Math.max(days || 0, 30);
// recent re-pulls count more: weights 1, 0.6, 0.36, ...
export function learn(perMonths: number[]): number | null {
  if (!perMonths.length) return null; let w = 1, s = 0, t = 0;
  for (const v of perMonths) { s += v * w; t += w; w *= 0.6; } return s / t;
}
const exported = (r: any) => (r?.unique_phone_numbers != null ? r.import_rows : r?.import_rows_new ?? r?.import_rows) || 0;

export type Repull = { pullId: string; prevPullId: string; date: string; days: number; prev: number; cur: number; remained: number; added: number; dropped: number;
  ownerChanged: number; phonesChanged: number; refresh: number; growth: number; perMonth: number };
export type ListRecycle = { key: string; profileId: string; zipGroup: string; market: string; pulls: number; lastDate: string; lastRows: number;
  lastYield: number | null; repulls: Repull[]; learnedPerMonth: number | null; interval: number; nextDate: string; measured: boolean };

export async function loadRecycling(): Promise<Map<string, ListRecycle>> {
  const [pulls, stats] = await Promise.all([
    select("list_pulls", { select: "pull_id,profile_id,zip_group,market_fips,uploaded_at,report", order: "uploaded_at.asc" }),
    select("recycle_stats", { select: "pull_id,prev_pull_id,profile_id,zip_group,uploaded_at,days_between,cur_props,prev_props,remained,added,dropped,owner_changed,phones_changed", order: "uploaded_at.desc" })]);
  const out = new Map<string, ListRecycle>();
  for (const p of pulls as any[]) {
    const key = `${p.profile_id}|${p.zip_group}`; const L = out.get(key) || { key, profileId: p.profile_id, zipGroup: p.zip_group, market: p.market_fips, pulls: 0, lastDate: "", lastRows: 0,
      lastYield: null, repulls: [], learnedPerMonth: null, interval: NO_DATA_INTERVAL, nextDate: "", measured: false };
    L.pulls++; L.lastDate = dayOf(p.uploaded_at); L.lastRows = p.report?.rows_in_file || 0;
    L.lastYield = L.lastRows ? exported(p.report) / L.lastRows : null; out.set(key, L);
  }
  for (const s of stats as any[]) {
    const L = out.get(`${s.profile_id}|${s.zip_group}`); if (!L) continue;
    const refresh = s.cur_props ? s.added / s.cur_props : 0, days = Number(s.days_between) || 0;
    L.repulls.push({ pullId: s.pull_id, prevPullId: s.prev_pull_id, date: dayOf(s.uploaded_at), days, prev: s.prev_props, cur: s.cur_props, remained: s.remained, added: s.added,
      dropped: s.dropped, ownerChanged: s.owner_changed, phonesChanged: s.phones_changed, refresh, growth: s.prev_props ? (s.cur_props - s.prev_props) / s.prev_props : 0, perMonth: perMonthOf(refresh, days) });
  }
  out.forEach((L) => {
    L.learnedPerMonth = learn(L.repulls.map((r) => r.perMonth)); L.measured = L.repulls.length > 0;
    L.interval = intervalFor(L.learnedPerMonth); L.nextDate = addDays(L.lastDate, L.interval);
  });
  return out;
}
