import { NextResponse } from "next/server";
import { STORAGE } from "@/lib/sb";
// Deletes TEST files only: storage objects whose path contains "ZZTEST" (Johnny approved removing fictional test data).
// Real files can't match: real pull ids start with "P-" and real uploads keep their PropStream file names.
const h = () => ({ apikey: process.env.SUPABASE_SERVICE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" });
async function list(bucket: string, prefix: string) {
  const r = await fetch(`${STORAGE}/object/list/${bucket}`, { method: "POST", headers: h(), body: JSON.stringify({ prefix, search: prefix ? "" : "ZZTEST", limit: 1000 }) });
  return r.ok ? ((await r.json()) as any[]) : [];
}
export async function POST() {
  const removed: string[] = [];
  for (const bucket of ["uploads", "outputs"]) {
    const paths: string[] = [];
    for (const o of await list(bucket, "")) {
      if (!String(o.name).includes("ZZTEST")) continue;
      if (o.id) paths.push(o.name);                                   // a file at the top level
      else for (const f of await list(bucket, `${o.name}/`)) if (f.id) paths.push(`${o.name}/${f.name}`);   // a folder
    }
    const safe = paths.filter((p) => p.includes("ZZTEST"));
    if (safe.length) {
      const r = await fetch(`${STORAGE}/object/${bucket}`, { method: "DELETE", headers: h(), body: JSON.stringify({ prefixes: safe }) });
      if (r.ok) removed.push(...safe.map((p) => `${bucket}/${p}`));
    }
  }
  return NextResponse.json({ ok: true, removed });
}
