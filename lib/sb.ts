// Supabase REST + Storage helpers (server only). Service key never reaches the browser.
const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_KEY || "";
const REST = `${URL_}/rest/v1`;
export const STORAGE = `${URL_}/storage/v1`;
const h = (extra: Record<string, string> = {}) => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...extra });

export async function select<T = any>(table: string, params: Record<string, string> = {}, page = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += page) {
    const qs = new URLSearchParams(params).toString();
    const r = await fetch(`${REST}/${table}?${qs}`, { headers: h({ "Range-Unit": "items", Range: `${off}-${off + page - 1}` }), cache: "no-store" });
    if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
    const rows = await r.json(); out.push(...rows);
    if (rows.length < page) return out;
  }
}

export async function upsert<T = any>(table: string, rows: any[], opts: { onConflict?: string; ignore?: boolean; returning?: boolean; chunk?: number } = {}): Promise<T[]> {
  const res: T[] = [];
  if (!rows.length) return res;
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).sort();
  const norm = rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] === undefined ? null : r[k]])));
  const chunk = opts.chunk ?? 500;
  const pref = (opts.ignore ? "resolution=ignore-duplicates" : "resolution=merge-duplicates") + (opts.returning ? ",return=representation" : ",return=minimal");
  for (let i = 0; i < norm.length; i += chunk) {
    const qs = opts.onConflict ? `?on_conflict=${opts.onConflict}` : "";
    const r = await fetch(`${REST}/${table}${qs}`, { method: "POST", headers: h({ Prefer: pref }), body: JSON.stringify(norm.slice(i, i + chunk)) });
    if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
    if (opts.returning) res.push(...(await r.json()));
  }
  return res;
}

export async function update(table: string, match: Record<string, string>, values: any) {
  const r = await fetch(`${REST}/${table}?${new URLSearchParams(match)}`, { method: "PATCH", headers: h({ Prefer: "return=minimal" }), body: JSON.stringify(values) });
  if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
}

export async function signedUpload(bucket: string, path: string) {
  const r = await fetch(`${STORAGE}/object/upload/sign/${bucket}/${path}`, { method: "POST", headers: h(), body: "{}" });
  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  return `${URL_}/storage/v1${j.url}`;
}
export async function download(bucket: string, path: string): Promise<ArrayBuffer> {
  const r = await fetch(`${STORAGE}/object/${bucket}/${path}`, { headers: h() });
  if (!r.ok) throw new Error(`download ${path}: ${r.status}`);
  return r.arrayBuffer();
}
export async function putObject(bucket: string, path: string, body: ArrayBuffer | Uint8Array | string, type: string) {
  const r = await fetch(`${STORAGE}/object/${bucket}/${path}`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": type, "x-upsert": "true" }, body: body as any });
  if (!r.ok) throw new Error(`upload ${path}: ${r.status} ${await r.text()}`);
}
export async function signedDownload(bucket: string, path: string, filename: string) {
  const r = await fetch(`${STORAGE}/object/sign/${bucket}/${path}`, { method: "POST", headers: h(), body: JSON.stringify({ expiresIn: 600 }) });
  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  return `${URL_}/storage/v1${j.signedURL}&download=${encodeURIComponent(filename)}`;
}
