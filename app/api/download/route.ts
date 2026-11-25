import { NextResponse } from "next/server";
import { signedDownload, select } from "@/lib/sb";
export async function GET(req: Request) {
  const u = new URL(req.url); const path = u.searchParams.get("path")!;
  // the GHL import file unlocks only after the export is confirmed
  if (path.endsWith("_GHL_IMPORT.csv")) {
    const [up] = await select("uploads", { "report->files->>import_csv": `eq.${path}`, select: "status" });
    if (up && up.status !== "confirmed") return new NextResponse(up.status === "draft" ? "Confirm the export on the Upload page first." : `This upload is ${up.status}. Its import file can't be used.`, { status: 403 });
  }
  return NextResponse.redirect(await signedDownload("outputs", path, path.split("/").pop()!));
}
