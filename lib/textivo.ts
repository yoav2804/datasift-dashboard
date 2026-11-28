// Textivo, READ ONLY. Copies campaigns, campaign KPIs, messages, opt-outs, lists, contacts and opportunities
// into textivo_raw exactly as the API returns them. Nothing is sent to or changed in Textivo (GET requests only).
// The API key lives in Supabase Vault as 'textivo_api_key' and is read through the app_secret() function.
import { rpc, select, upsert, update } from "./sb";

const BASE = "https://app.textivo.io/api/v1";
const PAGE = 100;

async function key(): Promise<string> {
  const k = await rpc<string>("app_secret", { p_name: "textivo_api_key" });
  if (!k) throw new Error("Textivo key not found in Supabase Vault (textivo_api_key)");
  return k;
}

async function get(k: string, path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`, { headers: { "X-API-Key": k, Accept: "application/json" }, cache: "no-store" });
  if (!r.ok) throw new Error(`Textivo ${path}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// Every page of a list endpoint (cursor pagination), up to a safety cap.
async function all(k: string, path: string, params: Record<string, string> = {}, maxPages = 200) {
  const out: any[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const j = await get(k, path, { ...params, limit: String(PAGE), ...(cursor ? { cursor } : {}) });
    const rows = Array.isArray(j?.data) ? j.data : [];
    out.push(...rows);
    if (!j?.hasMore || !j?.nextCursor) break;
    cursor = j.nextCursor;
  }
  return out;
}

const idOf = (o: any) => String(o?.id ?? o?.phone ?? o?.number ?? o?.e164 ?? JSON.stringify(o).slice(0, 200));

async function store(kind: string, rows: any[]) {
  const now = new Date().toISOString();
  await upsert("textivo_raw", rows.map((d) => ({ kind, ext_id: idOf(d), data: d, fetched_at: now })), { onConflict: "kind,ext_id" });
  return rows.length;
}

export async function syncTextivo() {
  const [run] = await upsert("textivo_sync_runs", [{ started_at: new Date().toISOString() }], { returning: true });
  const counts: Record<string, number> = {};
  try {
    const k = await key();
    // Messages: everything on the first run, then the last 3 days again (late delivery statuses), from the last good run.
    const last = (await select("textivo_sync_runs", { ok: "eq.true", select: "started_at", order: "started_at.desc", limit: "1" }))[0];
    const since = last ? new Date(new Date(last.started_at).getTime() - 3 * 864e5).toISOString() : undefined;

    const campaigns = await all(k, "/campaigns", { archived: "true" }).catch(() => all(k, "/campaigns"));
    counts.campaigns = await store("campaign", campaigns);
    const kpis: any[] = [];
    for (const c of campaigns) { try { const j = await get(k, `/campaigns/${c.id}/kpi`); kpis.push({ id: c.id, ...(j?.data ?? j) }); } catch { /* one campaign failing doesn't stop the run */ } }
    counts.campaign_kpis = await store("campaign_kpi", kpis);
    counts.messages = await store("message", await all(k, "/messages", since ? { createdAfter: since } : {}, 500));
    counts.opt_outs = await store("opt_out", await all(k, "/opt-outs"));
    const lists = await all(k, "/lists");
    counts.lists = await store("list", lists);
    counts.contacts = await store("contact", await all(k, "/contacts", {}, 500));
    counts.pipelines = await store("pipeline", await all(k, "/pipelines"));
    counts.opportunities = await store("opportunity", await all(k, "/opportunities"));

    await update("textivo_sync_runs", { run_id: `eq.${run.run_id}` }, { finished_at: new Date().toISOString(), ok: true, counts });
    return { run_id: run.run_id, counts, since: since || "all" };
  } catch (e: any) {
    await update("textivo_sync_runs", { run_id: `eq.${run.run_id}` }, { finished_at: new Date().toISOString(), ok: false, counts, error: String(e.message).slice(0, 1000) });
    throw e;
  }
}
