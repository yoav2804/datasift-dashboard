import { NextResponse } from "next/server";
import { signedDownload } from "@/lib/sb";
export async function GET(req: Request) {
  const u = new URL(req.url); const path = u.searchParams.get("path")!;
  return NextResponse.redirect(await signedDownload("outputs", path, path.split("/").pop()!));
}
