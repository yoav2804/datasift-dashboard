import { NextResponse } from "next/server";
import { confirmUpload, undoUpload, reassignUpload } from "@/lib/uploads";
export const maxDuration = 120;
export async function POST(req: Request) {
  const { uploadId, action, reason, toPull } = await req.json();
  try {
    if (action === "confirm") return NextResponse.json(await confirmUpload(uploadId));
    if (action === "undo") return NextResponse.json(await undoUpload(uploadId, reason));
    if (action === "reassign") return NextResponse.json(await reassignUpload(uploadId, toPull, reason));
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 400 }); }
}
