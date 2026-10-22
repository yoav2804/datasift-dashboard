import { NextResponse } from "next/server";
export async function POST(req: Request) {
  const { password } = await req.json();
  if (!password || password !== process.env.DASH_PASSWORD) return NextResponse.json({ ok: false }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set("ds_auth", process.env.DASH_TOKEN!, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 60, path: "/" });
  return res;
}
