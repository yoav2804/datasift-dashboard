import { NextResponse } from "next/server";
import { update } from "@/lib/sb";
export async function POST(req: Request) {
  const { caseId, status, notes } = await req.json();
  if (!["open", "new_opportunity", "ignore"].includes(status)) return NextResponse.json({ ok: false }, { status: 400 });
  await update("review_cases", { case_id: `eq.${caseId}` }, { status, decided_at: status === "open" ? null : new Date().toISOString(), ...(notes !== undefined ? { notes } : {}) });
  return NextResponse.json({ ok: true });
}
