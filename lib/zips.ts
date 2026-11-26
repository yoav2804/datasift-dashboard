// ZIP coverage for our target ZIPs (zip_priorities). Pulls come from confirmed uploads; outreach from the platform's message records.
import { select } from "./sb";
import { addDays, daysBetween, today, weekStart } from "./lists";

export type ZipCov = { zip: string; market: string; group: string | null; rank: number | null; lastPull: string | null; lastOutreach: string | null;
  pulledWeek: number; messagedWeek: number; m30: number; m60: number; m90: number; status: "this_week" | "recent" | "stale" | "neglected" | "never"; statusText: string };

export async function loadZipCoverage(weekOf?: string) {
  const t0 = today(), ws = weekStart(weekOf || t0), we = addDays(ws, 6);
  const [targets, daily] = await Promise.all([select("zip_priorities", { order: "market_fips.asc,rank.asc" }), select("zip_daily", {})]);
  const by = new Map<string, any[]>(); for (const d of daily as any[]) { const k = String(d.zip || "").slice(0, 5); by.set(k, [...(by.get(k) || []), d]); }
  const zips: ZipCov[] = (targets as any[]).map((z) => {
    const rows = by.get(z.zip) || []; const pulled = rows.filter((r) => r.kind === "pulled"), msg = rows.filter((r) => r.kind === "messaged");
    const last = (a: any[]) => a.map((r) => r.day).sort().pop() || null;
    const sumIn = (a: any[], from: string, to = t0) => a.filter((r) => r.day >= from && r.day <= to).reduce((s, r) => s + Number(r.n), 0);
    const lastOut = last(msg), lastPull = last(pulled);
    const pulledWeek = sumIn(pulled, ws, we), messagedWeek = sumIn(msg, ws, we);
    const age = lastOut ? daysBetween(lastOut, t0) : null;
    const status: ZipCov["status"] = pulledWeek || messagedWeek ? "this_week" : age == null ? (lastPull ? "neglected" : "never") : age <= 30 ? "recent" : age <= 60 ? "stale" : "neglected";
    const statusText = { this_week: "Covered this week", recent: `Outreach ${age} days ago`, stale: `No outreach for ${age} days`,
      neglected: lastOut ? `No outreach for ${age} days` : "Pulled, never messaged", never: "Never pulled" }[status];
    return { zip: z.zip, market: z.market_fips, group: z.zip_group || null, rank: z.rank ?? null, lastPull, lastOutreach: lastOut, pulledWeek, messagedWeek,
      m30: sumIn(msg, addDays(t0, -30)), m60: sumIn(msg, addDays(t0, -60)), m90: sumIn(msg, addDays(t0, -90)), status, statusText };
  });
  return { ws, we, zips };
}
// which target ZIPs a list covers: an all-ZIPs list covers every target ZIP in its market; a ZIP group covers its own ZIPs
export const zipsOfList = (zips: ZipCov[], market: string, group: string) => zips.filter((z) => z.market === market && (group === "ALL" || z.group === group));
export const needsCoverage = (z: ZipCov) => z.status !== "this_week" && z.status !== "recent";
