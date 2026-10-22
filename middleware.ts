import { NextResponse, NextRequest } from "next/server";
export function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname;
  if (p.startsWith("/login") || p.startsWith("/api/login") || p.startsWith("/api/sync-ghl") || p.startsWith("/_next") || p === "/favicon.ico") return NextResponse.next();
  if (req.cookies.get("ds_auth")?.value === process.env.DASH_TOKEN) return NextResponse.next();
  if (p.startsWith("/api/")) return NextResponse.json({ error: "not logged in" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}
