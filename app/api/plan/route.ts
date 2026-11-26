import { NextResponse } from "next/server";
import { upsert, update } from "@/lib/sb";
import { computePlan, pullIdFor, plannedDateFor } from "@/lib/planner";
// Planner actions (Supabase only):
//   settings  -> save the weekly capacity
//   add       -> put one recommended list on this week's calendar (moves its existing planned pull, or creates one)
//   add_all   -> the same for every recommendation
export async function POST(req: Request) {
  const body = await req.json();
  try {
    if (body.action === "settings") {
      const daily = Math.round(Number(body.daily_capacity)), days = Math.round(Number(body.working_days));
      if (!(daily > 0 && daily <= 20000 && days >= 1 && days <= 7)) throw new Error("Daily capacity must be 1-20,000 and working days 1-7.");
      await upsert("app_settings", [{ key: "planner", value: { daily_capacity: daily, working_days: days }, updated_at: new Date().toISOString() }], { onConflict: "key" });
      return NextResponse.json({ ok: true });
    }
    const plan = await computePlan(body.week);
    const date = plannedDateFor(plan.ws);
    const picks = body.action === "add_all" ? plan.picks : plan.picks.concat(plan.notPicked).filter((r) => r.key === body.key);
    if (!picks.length) throw new Error("That list is not available to plan this week.");
    let moved = 0, created = 0;
    for (const r of picks) {
      if (r.plannedTask && r.plannedTask.planned_date >= plan.ws && r.plannedTask.planned_date <= plan.we) {
        await update("pull_tasks", { pull_id: `eq.${r.plannedTask.pull_id}` }, { est_export_doors: r.est }); continue; }
      if (r.plannedTask) { await update("pull_tasks", { pull_id: `eq.${r.plannedTask.pull_id}` }, { planned_date: date, est_export_doors: r.est }); moved++; continue; }
      await upsert("pull_tasks", [{ pull_id: pullIdFor(r, date), market_fips: r.market, profile_id: r.profileId, zip_group: r.zipGroup, zips: r.zips, source_id: r.sourceId || "PROPSTREAM",
        priority: r.priority, planned_date: date, status: "planned", est_export_doors: r.est, notes: `planner: ${r.kind === "never" ? "never pulled" : "recycle due"}` }], { onConflict: "pull_id", ignore: true });
      created++;
    }
    return NextResponse.json({ ok: true, moved, created });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 400 }); }
}
