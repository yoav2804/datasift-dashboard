// GHL API: READ ONLY. This app never writes to GHL.
export async function ghlGet(path: string, params: Record<string, any>) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();
  for (let a = 0; a < 5; a++) {
    const r = await fetch(`https://services.leadconnectorhq.com/${path}?${qs}`, {
      headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: "2021-07-28", Accept: "application/json" }, cache: "no-store" });
    if (r.status === 429) { await new Promise((s) => setTimeout(s, 2000 + a * 2000)); continue; }
    if (!r.ok) throw new Error(`GHL ${path}: ${r.status} ${await r.text()}`);
    return r.json();
  }
  throw new Error("GHL rate limited");
}
