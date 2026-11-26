import { NextResponse } from "next/server";
// READ ONLY diagnostic: which GHL message endpoints can our API key read? Nothing is written anywhere.
const KEEP = /^(status|direction|messageType|type|channel|source|errorCode|error|code|nextCursor|total|traceId)$/i;
function strip(v: any, k = ""): any {
  if (Array.isArray(v)) return v.slice(0, 2).map((x) => strip(x));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, strip(vv, kk)]));
  return KEEP.test(k) ? v : typeof v;
}
export async function GET() {
  const loc = process.env.GHL_LOCATION_ID;
  const tries: [string, string][] = [
    ["conversations/search", `locationId=${loc}&limit=1`],
    ["conversations/messages/export", `locationId=${loc}&limit=1&channel=SMS`],
  ];
  const out: any[] = [];
  for (const [path, qs] of tries) {
    const r = await fetch(`https://services.leadconnectorhq.com/${path}?${qs}`, { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: "2021-07-28", Accept: "application/json" }, cache: "no-store" });
    const body = await r.text(); let shape: any = body.slice(0, 300);
    try { shape = strip(JSON.parse(body)); } catch {}
    out.push({ path, status: r.status, shape });   // field names and a few status values only, no message text or names
  }
  return NextResponse.json(out);
}
