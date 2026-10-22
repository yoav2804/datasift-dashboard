import { NextResponse } from "next/server";
import { update } from "@/lib/sb";
export async function POST(req: Request) {
  const { pullId, status, plannedDate } = await req.json();
  const v: any = {};
  if (status && ["planned", "skipped"].includes(status)) v.status = status;
  if (plannedDate) v.planned_date = plannedDate;
  await update("pull_tasks", { pull_id: `eq.${pullId}` }, v);
  return NextResponse.json({ ok: true });
}
