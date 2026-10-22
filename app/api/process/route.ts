import { NextResponse } from "next/server";
import { download } from "@/lib/sb";
import { processFile } from "@/lib/process";
export const maxDuration = 300;
export async function POST(req: Request) {
  const { path, filename, pullId } = await req.json();
  try {
    const buf = await download("uploads", path);
    const report = await processFile(buf, filename, pullId);
    return NextResponse.json({ ok: true, report });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 400 }); }
}
