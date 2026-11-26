import { NextResponse } from "next/server";
import { syncMessages } from "@/lib/messages";
export const maxDuration = 300;
// Nightly (and on demand): READ ONLY copy of GHL SMS message statuses. Call again until messages_caught_up is true.
export async function GET(req: Request) {
  const ok = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}` || (req.headers.get("cookie") || "").includes(`ds_auth=${process.env.DASH_TOKEN}`);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...(await syncMessages()) }); }
  catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
