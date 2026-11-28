import { NextResponse } from "next/server";
import { syncTextivo } from "@/lib/textivo";
export const maxDuration = 300;
// Nightly (and on demand): READ ONLY copy of Textivo campaigns, messages, opt-outs, lists, contacts and pipeline.
export async function GET(req: Request) {
  const ok = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}` || (req.headers.get("cookie") || "").includes(`ds_auth=${process.env.DASH_TOKEN}`);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...(await syncTextivo()) }); }
  catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
