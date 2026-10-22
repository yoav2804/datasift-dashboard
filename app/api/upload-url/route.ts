import { NextResponse } from "next/server";
import { signedUpload } from "@/lib/sb";
export async function POST(req: Request) {
  const { filename } = await req.json();
  const path = `${Date.now()}_${String(filename).replace(/[^\w.\-]/g, "_")}`;
  return NextResponse.json({ path, url: await signedUpload("uploads", path) });
}
