import { NextResponse } from "next/server";
import { syncGhl } from "@/lib/sync";
export const maxDuration = 300;
export async function GET(req: Request) {
  const ok = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}` || (req.headers.get("cookie") || "").includes(`ds_auth=${process.env.DASH_TOKEN}`);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...(await syncGhl()) }); }
  catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
