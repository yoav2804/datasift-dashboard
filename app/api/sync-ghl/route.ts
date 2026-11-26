import { NextResponse } from "next/server";
import { syncGhl } from "@/lib/sync";
import { syncOutcomes } from "@/lib/outcomes";
import { rpc } from "@/lib/sb";
export const maxDuration = 300;
export async function GET(req: Request) {
  const ok = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}` || (req.headers.get("cookie") || "").includes(`ds_auth=${process.env.DASH_TOKEN}`);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const a = await syncGhl(); const b = await syncOutcomes();
    const c = await rpc("refresh_import_status").catch((e) => ({ import_check_error: String(e) }));   // confirm which exported numbers reached GHL
    return NextResponse.json({ ok: true, ...a, ...b, ...c });
  }
  catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
