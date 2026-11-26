// Data Manager: process one PropStream export for one Pull ID. Writes to Supabase only, never to GHL.
// The result is a DRAFT: nothing counts (list stats, recycling, Tracker) until it is confirmed in lib/uploads.ts.
// A draft can be undone (voided); voided rows stay in the database but every page ignores them.
import * as XLSX from "xlsx";
import crypto from "crypto";
import { select, upsert, update, putObject } from "./sb";
import { norm } from "./phones";
import { voidPullRows } from "./uploads";
import { NO_DATA_INTERVAL, intervalFor, perMonthOf, learn } from "./recycling";

const COUNTY_FIPS: Record<string, string> = { "SAINT LOUIS CITY": "29510", "ST LOUIS CITY": "29510", "SAINT LOUIS": "29189", "ST LOUIS": "29189", "SAINT CHARLES": "29183", "ST CHARLES": "29183",
  "SAINT LOUIS COUNTY": "29189", "ST LOUIS COUNTY": "29189", "SAINT CHARLES COUNTY": "29183", "ST CHARLES COUNTY": "29183" };
const MARKET_NAME: Record<string, string> = { "29510": "St. Louis City", "29189": "St. Louis County", "29183": "St. Charles County" };
const LATEST = ["Owner Occupied", "Property Status", "Bedrooms", "Total Bathrooms", "Building Sqft", "Effective Year Built", "Est. Value", "Est. Equity", "Est. Loan-to-Value", "Total Open Loans", "Lien Amount", "Foreclosure Factor", "MLS Status", "Last Sale Recording Date", "Last Sale Amount", "Total Condition"];
const REQUIRED = ["Address", "Zip", "County", "APN", "Owner 1 First Name", "Owner 1 Last Name", "Mailing Address", "Phone 1", "Phone 1 Type"];

const clean = (s: any) => String(s ?? "").toUpperCase().replace(/[^\w# ]/g, " ").replace(/\s+/g, " ").trim();
const z5 = (z: any) => (z ? String(z).split(".")[0].split("-")[0].padStart(5, "0") : "");
const street = (a: any) => clean(a).split(" ").slice(0, 2).join(" ");
const RESIDENTIAL = /(RESIDENTIAL|SINGLE FAMILY|CONDO|TOWNHOUSE|DUPLEX|TRIPLEX|QUADRUPLEX|MULTI.?FAMILY|APARTMENT|MOBILE|MANUFACTURED|ROW HOUSE|PLANNED UNIT)/;
export const isResidential = (t: any) => !t || RESIDENTIAL.test(clean(t));
const inList = (vals: string[]) => `in.(${vals.map((v) => `"${String(v).replace(/"/g, "")}"`).join(",")})`;
async function inChunks<T>(vals: string[], size: number, fn: (part: string[]) => Promise<T[]>) {
  const out: T[] = [];
  for (let i = 0; i < vals.length; i += size) out.push(...(await fn(vals.slice(i, i + size))));
  return out;
}

export async function processFile(buf: ArrayBuffer, filename: string, pullId: string, opts: { market?: string; notes?: string; storagePath?: string; skipTrace?: string; sourceId?: string } = {}) {
  const NOW = new Date().toISOString();
  const sha = crypto.createHash("sha256").update(Buffer.from(buf)).digest("hex");
  if ((await select("uploads", { file_sha256: `eq.${sha}`, select: "upload_id" })).length) throw new Error("This exact file was already uploaded. Nothing was done.");

  const wb = XLSX.read(buf, { type: "array", raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const recs0: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
  const RECS = recs0.map((rec) => Object.fromEntries(Object.entries(rec).map(([k, v]) => [k.trim(), v === null || String(v).trim() === "" ? null : String(v).trim()])));
  if (!RECS.length) throw new Error("The file has no rows.");
  const missing = REQUIRED.filter((c) => !(c in RECS[0]));
  if (missing.length) throw new Error(`File is missing columns: ${missing.join(", ")}. Is this a PropStream export?`);

  let taskMarket: string | null = null;  // fallback: the market of the pull this file was uploaded for
  const marketOf = (r: any) => opts.market || COUNTY_FIPS[clean(r["County"])] || taskMarket;
  const addrKey = (r: any) => `${clean(r["Address"])}|${clean(r["Unit #"])}|${z5(r["Zip"])}`;

  // pull task
  let pt = (await select("pull_tasks", { pull_id: `eq.${pullId}` }))[0];
  if (!pt) {
    const mk = opts.market || RECS.map(marketOf).find(Boolean) || null;
    await upsert("pull_tasks", [{ pull_id: pullId, market_fips: mk, source_id: "PROPSTREAM", status: "pulled", notes: opts.notes || "created at upload" }]);
    pt = (await select("pull_tasks", { pull_id: `eq.${pullId}` }))[0];
  }
  if (pt.status === "draft") throw new Error("This pull already has a draft waiting. Confirm or undo it on the Upload page first.");
  if (pt.status === "processed") throw new Error("This pull was already processed and exported. Pick another pull.");
  taskMarket = pt.market_fips || null;
  const profileId = pt.profile_id;
  const prevStatus = pt.status;
  // where the list came from (the original source) and who found the phone numbers (the skip trace provider)
  const prof0 = pt.profile_id ? (await select("profiles", { profile_id: `eq.${pt.profile_id}`, select: "source_id" }))[0] : null;
  const sourceId = opts.sourceId || pt.source_id || prof0?.source_id || "PROPSTREAM";
  const skipTrace = (opts.skipTrace || "PropStream").trim();
  const [upload] = await upsert("uploads", [{ pull_id: pullId, filename, file_sha256: sha, row_count: RECS.length, status: "draft", storage_path: opts.storagePath || null,
    skip_trace_provider: skipTrace, original_source_id: sourceId }], { returning: true });
  await update("pull_tasks", { pull_id: `eq.${pullId}` }, { status: "draft" });

  try {
    // ---------- properties ----------
    const rows = RECS.map((r) => ({ r, market: marketOf(r), apn: r["APN"] || null, key: addrKey(r) } as any));
    const existing = new Map<string, any>();
    const apns = Array.from(new Set(rows.map((x) => x.apn).filter(Boolean))) as string[];
    for (const p of await inChunks(apns, 80, (part) => select("properties", { apn: inList(part), select: "property_id,market_fips,apn,address_key" })))
      existing.set(`apn|${p.market_fips}|${p.apn}`, p);
    const keys = Array.from(new Set(rows.map((x) => x.key))) as string[];
    for (const p of await inChunks(keys, 60, (part) => select("properties", { address_key: inList(part), select: "property_id,market_fips,apn,address_key" })))
      existing.set(`key|${p.address_key}`, p);

    // Resolve every row to ONE target property, using the same keys the database enforces:
    // address_key (unique) and market+APN (unique when APN is set).
    // 1) address already in the database -> that property
    // 2) APN already in the database -> that property
    // 3) otherwise a new property; rows that share an address or an APN become the same new property
    const apnK = (x: any) => (x.apn ? `${x.market}|${x.apn}` : "");
    const dbApnOwner = new Map<string, string>();   // market|apn -> property_id already holding it
    existing.forEach((p) => { if (p.apn) dbApnOwner.set(`${p.market_fips}|${p.apn}`, p.property_id); });
    const dbById = new Map<string, any>(); existing.forEach((p) => dbById.set(p.property_id, p));
    for (const x of rows) {
      const hit = existing.get(`key|${x.key}`) || (x.apn && existing.get(`apn|${x.market}|${x.apn}`));
      if (hit) x.target = `pid:${hit.property_id}`;
    }
    // a new row that shares an APN with a row already tied to a known property joins that property
    const apnTarget = new Map<string, string>();
    for (const x of rows) if (x.target && apnK(x) && !apnTarget.has(apnK(x))) apnTarget.set(apnK(x), x.target);
    for (const x of rows) if (!x.target && apnK(x) && apnTarget.has(apnK(x))) x.target = apnTarget.get(apnK(x));
    // remaining new rows: union by address and by APN
    const parent = new Map<string, string>();
    const find = (a: string): string => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a)!)!); a = parent.get(a)!; } return a; };
    const join = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
    const fresh0 = rows.filter((x) => !x.target);
    for (const x of fresh0) { parent.set(`k:${x.key}`, parent.get(`k:${x.key}`) || `k:${x.key}`); if (apnK(x)) parent.set(`a:${apnK(x)}`, parent.get(`a:${apnK(x)}`) || `a:${apnK(x)}`); }
    for (const x of fresh0) if (apnK(x)) join(`k:${x.key}`, `a:${apnK(x)}`);
    const clusterKey = new Map<string, string>();   // union root -> address_key of the first row in the cluster
    for (const x of fresh0) { const root = find(`k:${x.key}`); if (!clusterKey.has(root)) clusterKey.set(root, x.key); x.target = `new:${clusterKey.get(root)}`; }

    // build one record per target, merging every row that points to it (first row wins, blanks filled from the others)
    const groups = new Map<string, any[]>();
    for (const x of rows) groups.set(x.target, [...(groups.get(x.target) || []), x]);
    const apnUsed = new Map(dbApnOwner);
    const props: any[] = [];
    let dupInFile = 0;
    groups.forEach((xs, target) => {
      dupInFile += xs.length - 1;
      const first = xs[0], isNew = target.startsWith("new:");
      const pick = (col: string) => xs.map((x) => x.r[col]).find((v) => v !== null && v !== undefined) ?? null;
      const latest: any = {};
      for (const x of xs) for (const k of LATEST) if (x.r[k] && latest[k] === undefined) latest[k] = x.r[k];
      const db = isNew ? null : dbById.get(target.slice(4));
      // APN: keep what the database already has; otherwise take the first APN no other property holds
      let apn = db?.apn || null;
      if (!apn) for (const x of xs) { const k = apnK(x); if (k && (!apnUsed.has(k) || apnUsed.get(k) === target)) { apn = x.apn; apnUsed.set(k, target); break; } }
      const rec: any = { market_fips: first.market || xs.find((x) => x.market)?.market || null, apn, address_key: db ? db.address_key : target.slice(4), address: pick("Address"), unit: pick("Unit #"),
        city: pick("City"), state: pick("State"), zip: z5(pick("Zip")), county: pick("County"), property_type: pick("Property Type"), last_seen_at: NOW, latest };
      if (db) rec.property_id = db.property_id;
      const apns = Array.from(new Set(xs.map((x) => x.apn).filter(Boolean)));
      props.push({ r: first.r, rows: xs, market: first.market, key: rec.address_key, rec, wasNew: isNew, pid: db?.property_id, apns });
    });

    const ins = props.filter((x) => x.wasNew);
    const got = await upsert("properties", ins.map((x) => x.rec), { onConflict: "address_key", returning: true });
    const byKey = new Map(got.map((g: any) => [g.address_key, g.property_id]));
    for (const x of ins) x.pid = byKey.get(x.key);
    const upd = props.filter((x) => !x.wasNew);
    if (upd.length) await upsert("properties", upd.map((x) => x.rec), { onConflict: "property_id" });
    if (props.some((x) => !x.pid)) throw new Error("Some properties did not get an ID. Nothing was exported.");

    // retry safety: if an earlier failed attempt of THIS pull already created a property, it still counts as new
    const prior = await inChunks(props.map((x) => x.pid), 150, (part) => select("property_pulls", { pull_id: `eq.${pullId}`, property_id: `in.(${part.join(",")})`, select: "property_id,was_new" }));
    const priorNew = new Set(prior.filter((p: any) => p.was_new).map((p: any) => p.property_id));
    for (const x of props) if (priorNew.has(x.pid)) x.wasNew = true;
    // a property whose only earlier pulls were voided (undone or failed) is still new to us
    const known = props.filter((x) => !x.wasNew);
    const validElsewhere = new Set<string>();
    for (const r of await inChunks(known.map((x) => x.pid), 150, (part) => select("property_pulls", { property_id: `in.(${part.join(",")})`, pull_id: `neq.${pullId}`, voided_at: "is.null", select: "property_id" })))
      validElsewhere.add(r.property_id);
    for (const x of known) if (!validElsewhere.has(x.pid)) x.wasNew = true;

    // source rows are kept: the first row as raw, every other row that merged into this property under _merged_rows
    const rawOf = (r: any) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null));
    await upsert("property_pulls", props.map((x) => ({ property_id: x.pid, pull_id: pullId, upload_id: upload.upload_id, was_new: x.wasNew, voided_at: null,
      raw: { ...rawOf(x.r), ...(x.rows.length > 1 ? { _source_rows: x.rows.length, _apns: x.apns, _merged_rows: x.rows.slice(1).map((y: any) => rawOf(y.r)) } : {}) } })),
      { onConflict: "property_id,pull_id" });
    // list lifespan: which of these properties were already on THIS list in an earlier pull
    const seenOnList = new Set<string>();
    if (profileId) {
      for (const r of await inChunks(props.map((x) => x.pid), 150, (part) => select("property_profiles", { profile_id: `eq.${profileId}`, property_id: `in.(${part.join(",")})`, voided_at: "is.null", select: "property_id,first_pull_id" }))) if (r.first_pull_id !== pullId) seenOnList.add(r.property_id);
    }
    if (profileId) {
      // a link left by a voided run is taken over by this pull
      const pids = props.map((x) => x.pid);
      for (let i = 0; i < pids.length; i += 150)
        await update("property_profiles", { profile_id: `eq.${profileId}`, property_id: `in.(${pids.slice(i, i + 150).join(",")})`, voided_at: "not.is.null" }, { voided_at: null, first_pull_id: pullId, first_matched_at: NOW });
      await upsert("property_profiles", props.map((x) => ({ property_id: x.pid, profile_id: profileId, first_pull_id: pullId })), { onConflict: "property_id,profile_id", ignore: true });
    }

    // ---------- owners ----------
    const ownerKey = (r: any) => [clean(r["Owner 1 First Name"]), clean(r["Owner 1 Last Name"]), clean(r["Owner 2 First Name"]), clean(r["Owner 2 Last Name"]), clean(r["Mailing Address"]), z5(r["Mailing Zip"])].join("|");
    const okeys = new Map<string, any>();
    for (const x of props) for (const y of x.rows) {
      const r = y.r; y.okey = ownerKey(r); if (y === x.rows[0]) x.okey = y.okey;
      okeys.set(y.okey, { owner_key: y.okey, owner1_first: r["Owner 1 First Name"], owner1_last: r["Owner 1 Last Name"], owner2_first: r["Owner 2 First Name"], owner2_last: r["Owner 2 Last Name"],
        mailing_address: r["Mailing Address"], mailing_unit: r["Mailing Unit #"], mailing_city: r["Mailing City"], mailing_state: r["Mailing State"], mailing_zip: z5(r["Mailing Zip"]) });
    }
    await upsert("owners", Array.from(okeys.values()), { onConflict: "owner_key", ignore: true });
    const oid = new Map<string, string>();
    for (const o of await inChunks(Array.from(okeys.keys()), 40, (part) => select("owners", { owner_key: inList(part), select: "owner_id,owner_key" }))) oid.set(o.owner_key, o.owner_id);
    await upsert("property_owners", props.flatMap((x) => x.rows.map((y: any) => ({ property_id: x.pid, owner_id: oid.get(y.okey), first_pull_id: pullId, last_seen_at: NOW }))), { onConflict: "property_id,owner_id" });

    // ---------- phones ----------
    const items: any[] = [], excluded: any[] = []; let rawPhones = 0;
    for (const x of props) { const here = new Set<string>(); for (const y of x.rows) {
      const r = y.r; const lit = x.rows.some((z: any) => String(z.r["Litigator"] || "").toLowerCase() === "yes");
      for (let s = 1; s <= 5; s++) {
        const raw = r[`Phone ${s}`]; if (!raw) continue; rawPhones++;
        const n = norm(raw); const base = { x, okey: y.okey, slot: s, raw, phone: n, type: r[`Phone ${s} Type`], dnc: !!r[`Phone ${s} DNC`], lit };
        if (!n) { excluded.push({ ...base, reason: "invalid number" }); continue; }
        if (here.has(n)) continue;
        here.add(n); items.push(base);
      }
    } }
    const allp = Array.from(new Set(items.map((i) => i.phone))) as string[];
    const ghl = new Map<string, string[]>(), hist = new Map<string, any[]>(), ghlMain = new Set<string>();
    for (const g of await inChunks(allp, 150, (part) => select("ghl_contact_phones", { phone: `in.(${part.join(",")})`, select: "phone,contact_id,field" }))) {
      ghl.set(g.phone, [...(ghl.get(g.phone) || []), g.contact_id]);
      if (g.field === "phone") ghlMain.add(g.phone);   // GHL only matches duplicates on the main Phone field
    }
    for (const h of await inChunks(allp, 150, (part) => select("property_phones", { phone: `in.(${part.join(",")})`, voided_at: "is.null", select: "phone,property_id,first_pull_id" })))
      hist.set(h.phone, [...(hist.get(h.phone) || []), h]);
    const cids = Array.from(new Set(Array.from(ghl.values()).flat()));
    const gc = new Map<string, any>();
    for (const c of await inChunks(cids, 100, (part) => select("ghl_contacts", { contact_id: `in.(${part.join(",")})`, select: "contact_id,name,dnd,date_added,raw" }))) gc.set(c.contact_id, c);

    await upsert("phones", allp.map((p) => { const its = items.filter((i) => i.phone === p);
      return { phone: p, last_type: its[0].type, propstream_dnc: its.some((i) => i.dnc), litigator: its.some((i) => i.lit) }; }), { onConflict: "phone" });

    const batchProps = new Map<string, Set<string>>();
    for (const i of items) { if (!batchProps.has(i.phone)) batchProps.set(i.phone, new Set()); batchProps.get(i.phone)!.add(i.x.pid); }

    // numbers that already entered our texting operation: in GHL, or sent in an earlier confirmed export
    const texted = new Map<string, Set<string>>();
    for (const r of await inChunks(allp, 150, (part) => select("export_rows", { phone: `in.(${part.join(",")})`, bucket: "in.(new,existing,review)",
      select: "phone,property_id,export_batches!inner(approved,voided_at)", "export_batches.approved": "eq.true", "export_batches.voided_at": "is.null" }))) {
      if (!texted.has(r.phone)) texted.set(r.phone, new Set()); if (r.property_id) texted.get(r.phone)!.add(r.property_id);
    }

    // Every valid number gets exactly one outreach status, plus a "shared" note when it is also linked to another property.
    //   new         -> goes to the outreach export
    //   in_texting  -> already in GHL or already sent: excluded, so nobody gets texted twice
    //   dup_in_list -> same number on an earlier property in this file: sent once, with the first property
    // Shared numbers are logged automatically (no manual review) as same owner / different owner / unknown.
    const fresh: any[] = [], existingL: any[] = [], dupL: any[] = [], review: any[] = [], held: any[] = [];
    const keeper = new Map<string, string>();   // phone -> the property in this file that sends it
    for (const i of items) {
      const x = i.x, p = i.phone;
      if (!isResidential(x.r["Property Type"])) { excluded.push({ ...i, reason: `non-residential (${x.r["Property Type"]})` }); continue; }
      if (i.lit) { excluded.push({ ...i, reason: "litigator flag on owner" }); continue; }
      if (String(i.type || "").toLowerCase() === "landline") { excluded.push({ ...i, reason: "landline" }); continue; }
      const cs = (ghl.get(p) || []).map((c) => gc.get(c)).filter(Boolean);
      const ghlOther = cs.filter((c) => c.raw?.address1 && street(c.raw.address1) !== street(x.r["Address"]));
      const ghlSame = cs.filter((c) => !c.raw?.address1 || street(c.raw.address1) === street(x.r["Address"]));
      const otherHist = (hist.get(p) || []).filter((h) => h.property_id !== x.pid && h.first_pull_id !== pullId);
      const otherTexted = Array.from(texted.get(p) || []).filter((q) => q !== x.pid);
      const otherFile = Array.from(batchProps.get(p)!).filter((q) => q !== x.pid);
      i.inDb = (hist.get(p) || []).some((h) => h.first_pull_id !== pullId);
      i.ghl = ghlSame[0] || cs[0] || null;
      if (ghlOther.length && !ghlSame.length) i.shared = { reason: "in_ghl_other_property", ghl: ghlOther[0] };
      else if (otherHist.length || otherTexted.length) i.shared = { reason: "shared_in_history", other: otherHist.length ? otherHist : otherTexted.map((q) => ({ property_id: q })) };
      else if (otherFile.length) i.shared = { reason: "shared_in_batch" };
      if (cs.length || texted.has(p)) { i.where = cs.length ? "in GHL" : "sent in an earlier export"; existingL.push(i); }
      else if (keeper.has(p) && keeper.get(p) !== x.pid) dupL.push(i);
      else { keeper.set(p, x.pid); fresh.push(i); }
      if (i.shared) review.push(Object.assign(i, { reason: i.shared.reason, other: i.shared.other, ghlOther: i.shared.ghl }));
    }

    // property-phone links: new ones are inserted; a link left by a voided run is taken over by this pull
    const voidedLinks = new Set<string>();
    for (const r of await inChunks(Array.from(new Set(items.map((i) => i.x.pid))) as string[], 150, (part) => select("property_phones", { property_id: `in.(${part.join(",")})`, voided_at: "not.is.null", select: "property_id,phone" })))
      voidedLinks.add(`${r.property_id}|${r.phone}`);
    const linkRow = (i: any) => ({ property_id: i.x.pid, phone: i.phone, owner_id: oid.get(i.okey || i.x.okey), slot: i.slot, phone_type: i.type, propstream_dnc: i.dnc, first_pull_id: pullId, voided_at: null });
    const isVoidedLink = (i: any) => voidedLinks.has(`${i.x.pid}|${i.phone}`);
    await upsert("property_phones", items.filter(isVoidedLink).map(linkRow), { onConflict: "property_id,phone" });
    await upsert("property_phones", items.filter((i) => !isVoidedLink(i)).map(linkRow), { onConflict: "property_id,phone", ignore: true });

    const pidX = new Map(props.map((x) => [x.pid, x]));
    const histAddr = new Map<string, string>(), histOwner = new Map<string, any[]>();
    const histIds = Array.from(new Set(review.flatMap((i) => (i.other || []).map((o: any) => o.property_id)))) as string[];
    for (const p of await inChunks(histIds, 100, (part) => select("properties", { property_id: `in.(${part.join(",")})`, select: "property_id,address,city,zip" })))
      histAddr.set(p.property_id, `${p.address}, ${p.city} ${p.zip}`);
    for (const o of await inChunks(histIds, 100, (part) => select("property_owners", { property_id: `in.(${part.join(",")})`, select: "property_id,owners(owner1_last,mailing_address)" })))
      histOwner.set(o.property_id, [...(histOwner.get(o.property_id) || []), o.owners]);
    for (const i of review) {
      const a = i.x.r, last = clean(a["Owner 1 Last Name"]), mail = clean(a["Mailing Address"]);
      if (i.reason === "in_ghl_other_property") {
        const g = i.ghlOther?.raw || {}; i.ghl = i.ghlOther;
        i.nameMatch = clean(g.lastName) && last ? clean(g.lastName) === last : null; i.mailMatch = null; i.otherAddr = g.address1 || g.address || "";
      } else if (i.reason === "shared_in_history") {
        const op = i.other[0].property_id; const os = histOwner.get(op) || [];
        i.otherAddr = histAddr.get(op) || "";
        i.nameMatch = os.length && last ? os.some((o: any) => clean(o?.owner1_last) === last) : null;
        i.mailMatch = os.length && mail ? os.some((o: any) => clean(o?.mailing_address) === mail) : null;
      } else {
        const o = Array.from(batchProps.get(i.phone)!).filter((q) => q !== i.x.pid).map((q) => pidX.get(q)).filter(Boolean)[0];
        i.nameMatch = o && last ? last === clean(o.r["Owner 1 Last Name"]) : null;
        i.mailMatch = o && mail ? mail === clean(o.r["Mailing Address"]) : null; i.otherAddr = o?.r["Address"] || "";
      }
      // same owner = legitimate multi-property ownership; different owner = the number may be wrong for one of them
      i.relation = i.nameMatch || i.mailMatch ? "same_owner" : i.nameMatch === false && i.mailMatch !== true ? "different_owner" : "unknown";
    }
    // review cases: new ones are inserted; a case left by a voided run is reopened for this pull
    const voidedCases = new Set<string>();
    for (const r of await inChunks(Array.from(new Set(review.map((i) => i.x.pid))) as string[], 150, (part) => select("review_cases", { new_property_id: `in.(${part.join(",")})`, status: "eq.voided", select: "phone,new_property_id" })))
      voidedCases.add(`${r.phone}|${r.new_property_id}`);
    const caseRow = (i: any) => ({ phone: i.phone, reason: i.reason, ghl_contact_id: i.ghl?.contact_id || null, new_property_id: i.x.pid,
      owner_name_match: i.nameMatch, mailing_match: i.mailMatch, owner_relation: i.relation, status: "logged", pull_id: pullId, original_property_id: i.other?.[0]?.property_id || null,
      notes: i.otherAddr ? `Other property: ${i.otherAddr}` : null });
    const isVoidedCase = (i: any) => voidedCases.has(`${i.phone}|${i.x.pid}`);
    await upsert("review_cases", review.filter(isVoidedCase).map((i) => ({ ...caseRow(i), status: "logged", decided_at: null })), { onConflict: "phone,new_property_id" });
    await upsert("review_cases", review.filter((i) => !isVoidedCase(i)).map(caseRow), { onConflict: "phone,new_property_id", ignore: true });

    // ---------- outputs ----------
    const base = (i: any) => { const r = i.x.r; return { "Property ID": i.x.pid, Address: r["Address"], City: r["City"], Zip: z5(r["Zip"]),
      Owner: [r["Owner 1 First Name"], r["Owner 1 Last Name"]].filter(Boolean).join(" "),
      Mailing: [r["Mailing Address"], r["Mailing City"], r["Mailing State"], z5(r["Mailing Zip"])].filter(Boolean).join(" "),
      Phone: i.phone || i.raw, Type: i.type, Slot: i.slot, "PropStream DNC": i.dnc ? "Yes" : "", "Property New To Us": i.x.wasNew ? "Yes" : "No" }; };
    const WHY: any = { in_ghl_other_property: "Number in GHL on a different property", shared_in_history: "Number linked before to a different property", shared_in_batch: "Same number on 2+ properties in this file" };
    const REL: any = { same_owner: "Same owner (multi-property)", different_owner: "Different owner: number may be wrong", unknown: "Unknown" };
    const outNew = fresh.map(base);
    const outExist = existingL.map((i) => ({ ...base(i), Where: i.where, "GHL Contact ID": i.ghl?.contact_id || "", "GHL Name": i.ghl?.name || "",
      "GHL DND": i.ghl ? (i.ghl.dnd ? "Yes" : "No") : "", "In GHL Since": (i.ghl?.date_added || "").slice(0, 10) }));
    const outDup = dupL.map((i) => ({ ...base(i), "Sent With Property": pidX.get(keeper.get(i.phone)!)?.r["Address"] || "" }));
    const outRev = review.map((i) => ({ ...base(i), "Outreach Status": fresh.includes(i) ? "Sent (new)" : dupL.includes(i) ? "Sent with another property in this list" : "Excluded: already in texting",
      Why: WHY[i.reason], Owner: REL[i.relation], "Other Property": i.otherAddr || "", "GHL Contact ID": i.ghl?.contact_id || "",
      "Same Owner Last Name": i.nameMatch === null ? "" : i.nameMatch ? "Yes" : "No", "Same Mailing Address": i.mailMatch == null ? "" : i.mailMatch ? "Yes" : "No" }));
    const outExc = excluded.map((i) => ({ ...base(i), Reason: i.reason }));
    const outHeld = held.map((i) => ({ ...base(i), Reason: i.reason }));

    // outreach export: only numbers that never entered our texting operation, each number once
    const imp = new Map<string, any[]>();
    for (const i of fresh) imp.set(i.x.pid, [...(imp.get(i.x.pid) || []), i]);
    const dupRows = 0, trapRows = 0;
    const outImp: any[] = [];
    imp.forEach((ph0, pid) => {
      const r = ph0[0].x.r;
      const ph = ph0.sort((a, b) => a.slot - b.slot).slice(0, 4);
      outImp.push({ "First Name": r["Owner 1 First Name"] || "", "Last Name": r["Owner 1 Last Name"] || "", Phone: ph[0].phone, "Phone Type": ph[0].type,
        "Phone 2": ph[1]?.phone || "", "Phone 2 Type": ph[1]?.type || "", "Phone 3": ph[2]?.phone || "", "Phone 3 Type": ph[2]?.type || "", "Phone 4": ph[3]?.phone || "", "Phone 4 Type": ph[3]?.type || "",
        Address: r["Address"], City: r["City"], State: r["State"], "Postal Code": z5(r["Zip"]),
        "Property Address For AI": `${r["Address"]}, ${r["City"]}, ${r["State"]} ${z5(r["Zip"])}`,
        "DS Property ID": pid, "DS Pull ID": pullId, "DS Profile": profileId || "", "DS ZIP Group": pt.zip_group || "", "DS Market": ph0[0].x.market || "",
        "DS Skip Trace": skipTrace, "DS Source": sourceId, "DS Status": "New" });
    });
    const uniq = (arr: any[]) => new Set(arr.map((i) => i.phone)).size;
    const pctOf = (a: number) => (allp.length ? Math.round((a / allp.length) * 1000) / 10 : 0);
    const dupInListNumbers = Array.from(batchProps.values()).filter((v) => v.size > 1).length;
    const phoneStats = {
      total_phone_entries: rawPhones, unique_phone_numbers: allp.length,
      numbers_on_2plus_properties_in_list: dupInListNumbers, pct_numbers_duplicated_in_list: pctOf(dupInListNumbers),
      numbers_already_in_our_database: allp.filter((p) => (hist.get(p) || []).some((h) => h.first_pull_id !== pullId)).length,
      numbers_already_in_texting: uniq(existingL), pct_numbers_already_in_texting: pctOf(uniq(existingL)),
      numbers_shared_with_other_property: uniq(review), pct_numbers_shared_with_other_property: pctOf(uniq(review)),
      numbers_shared_same_owner: uniq(review.filter((i) => i.relation === "same_owner")),
      numbers_shared_different_owner: uniq(review.filter((i) => i.relation === "different_owner")),
      numbers_excluded_landline_litigator_nonres: uniq(excluded.filter((e) => e.phone)),
      new_numbers_for_outreach: uniq(fresh), pct_new_for_outreach: pctOf(uniq(fresh)),
    };

    // smart recycling: compare with the previous CONFIRMED pull of the same list (same DataSift profile + ZIP group)
    const newToList = props.filter((x) => !seenOnList.has(x.pid)).length;
    const freshShare = props.length ? newToList / props.length : 1;
    let recycle: any = null;
    let nextDays = NO_DATA_INTERVAL, refreshNote = "First pull of this list. Pull it again in 30 days to measure how fast it refreshes.";
    if (profileId) {
      const prev = (await select("list_pulls", { profile_id: `eq.${profileId}`, zip_group: `eq.${pt.zip_group || "ALL"}`, pull_id: `neq.${pullId}`, order: "uploaded_at.desc", limit: "1",
        select: "pull_id,uploaded_at" }))[0];
      if (prev) {
        const prevRows = await select("property_pulls", { pull_id: `eq.${prev.pull_id}`, voided_at: "is.null", select: "property_id,raw" });
        const prevBy = new Map(prevRows.map((r: any) => [r.property_id, r.raw || {}]));
        const curIds = new Set(props.map((x) => x.pid));
        const phonesOf = (r: any) => Array.from(new Set([1, 2, 3, 4, 5].map((i) => String(r?.[`Phone ${i}`] ?? "").replace(/\D/g, "").slice(-10)).filter((d) => d.length === 10))).sort().join(",");
        let remained = 0, ownerChanged = 0, phonesChanged = 0;
        for (const x of props) { const b: any = prevBy.get(x.pid); if (!b) continue; remained++;
          if (clean(b["Owner 1 Last Name"]) !== clean(x.r["Owner 1 Last Name"]) || clean(b["Mailing Address"]) !== clean(x.r["Mailing Address"])) ownerChanged++;
          if (phonesOf(b) !== phonesOf(x.r)) phonesChanged++; }
        const added = props.length - remained, dropped = prevRows.filter((r: any) => !curIds.has(r.property_id)).length;
        const days = Math.round((Date.now() - Date.parse(prev.uploaded_at)) / 864e5);
        const refresh = props.length ? added / props.length : 0;
        const past = await select("recycle_stats", { profile_id: `eq.${profileId}`, zip_group: `eq.${pt.zip_group || "ALL"}`, order: "uploaded_at.desc", select: "cur_props,added,days_between" });
        const learned = learn([perMonthOf(refresh, days), ...past.map((r: any) => perMonthOf(r.cur_props ? r.added / r.cur_props : 0, Number(r.days_between) || 0))]);
        nextDays = intervalFor(learned);
        recycle = { prev_pull_id: prev.pull_id, days_between: days, prev_properties: prevRows.length, properties: props.length, remained, added, dropped,
          owner_changed: ownerChanged, phones_changed: phonesChanged, refresh_pct: Math.round(refresh * 1000) / 10,
          growth_pct: prevRows.length ? Math.round(((props.length - prevRows.length) / prevRows.length) * 1000) / 10 : null,
          refresh_per_month_pct: Math.round(perMonthOf(refresh, days) * 1000) / 10, learned_per_month_pct: learned == null ? null : Math.round(learned * 1000) / 10,
          measurements: past.length + 1, interval_days: nextDays };
        refreshNote = `${recycle.refresh_pct}% of this list is new since the pull ${days} days ago (${added.toLocaleString()} added, ${dropped.toLocaleString()} dropped, size ${recycle.growth_pct ?? 0}%). `
          + `Learned refresh about ${recycle.learned_per_month_pct}% a month over ${recycle.measurements} re-pull${recycle.measurements === 1 ? "" : "s"}, so next pull in ${nextDays} days.`;
      }
    }
    const nextDate = new Date(Date.now() + nextDays * 864e5).toISOString().slice(0, 10);

    const zipDist: Record<string, number> = {};
    for (const x of props) { const z = z5(x.r["Zip"]); zipDist[z] = (zipDist[z] || 0) + 1; }

    // sanity checks: does this file belong to the pull it was uploaded under?
    const warnings: string[] = [];
    if (pt.market_fips) {
      const off = new Map<string, number>(); let unknown = 0;
      for (const r of RECS) { const m = COUNTY_FIPS[clean(r["County"])]; if (!m) unknown++; else if (m !== pt.market_fips) off.set(m, (off.get(m) || 0) + 1); }
      off.forEach((n, m) => warnings.push(`${n} of ${RECS.length} rows are in ${MARKET_NAME[m] || m}, but this pull is for ${MARKET_NAME[pt.market_fips] || pt.market_fips}.`));
      if (unknown) warnings.push(`${unknown} of ${RECS.length} rows have a county outside our 3 markets or no county.`);
    }
    if (pt.zips?.length) {
      const allowed = new Set((pt.zips as string[]).map(z5));
      const outside = props.filter((x) => !allowed.has(z5(x.r["Zip"]))).length;
      if (outside) warnings.push(`${outside} of ${props.length} properties are outside this pull's ZIP group (${pt.zip_group}).`);
    }
    const report: any = { upload_id: upload.upload_id, warnings, skip_trace_provider: skipTrace, source_id: sourceId, pull_id: pullId, file: filename, rows_in_file: RECS.length, duplicate_rows_in_file: dupInFile, unique_properties: props.length,
      net_new_properties: props.filter((x) => x.wasNew).length, already_known_properties: props.filter((x) => !x.wasNew).length,
      non_residential_properties: props.filter((x) => !isResidential(x.r["Property Type"])).length,
      properties_with_any_phone: new Set(items.map((i) => i.x.pid)).size, unique_valid_phones: allp.length, property_phone_pairs: items.length,
      invalid_numbers: excluded.filter((e) => e.reason === "invalid number").length, landlines: excluded.filter((e) => e.reason === "landline").length,
      litigator_numbers: excluded.filter((e) => e.reason.startsWith("litigator")).length, non_residential_numbers: excluded.filter((e) => e.reason.startsWith("non-residential")).length,
      held_propstream_dnc: held.length, already_in_ghl: existingL.filter((i) => i.where === "in GHL").length, already_sent_not_in_ghl: existingL.filter((i) => i.where !== "in GHL").length,
      existing_ghl_dnd: existingL.filter((i) => i.ghl?.dnd).length, multi_property_review: review.length, new_numbers: fresh.length, duplicate_in_list_skipped: dupL.length, import_rows: outImp.length, ...phoneStats,
      import_rows_new: outImp.length - dupRows, import_rows_duplicates: dupRows, import_rows_may_create_second_contact: trapRows,
      properties_new_to_list: newToList, properties_already_on_list: props.length - newToList, pct_new_to_list: Math.round(freshShare * 1000) / 10,
      pct_already_known: props.length ? Math.round((props.filter((x) => !x.wasNew).length / props.length) * 1000) / 10 : 0,
      refresh_note: profileId ? refreshNote : "", next_pull_date: profileId ? nextDate : null, recycle, zip_distribution: zipDist };

    const out = XLSX.utils.book_new();
    const add = (name: string, data: any[]) => XLSX.utils.book_append_sheet(out, data.length ? XLSX.utils.json_to_sheet(data) : XLSX.utils.aoa_to_sheet([["(none)"]]), name);
    add("Pull Report", Object.entries(report).map(([k, v]) => ({ Metric: k.replace(/_/g, " "), Value: typeof v === "object" ? JSON.stringify(v) : v })));
    add("Outreach Import", outImp); add("New Numbers", outNew); add("Already In Texting", outExist); add("Duplicate In List", outDup); add("Shared Numbers", outRev); add("Excluded", outExc);
    const xbuf = XLSX.write(out, { type: "buffer", bookType: "xlsx" });
    const csv = outImp.length ? XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(outImp)) : "";
    const stamp = NOW.slice(0, 19).replace(/[:T]/g, "-");
    const xPath = `${pullId}/${stamp}_results.xlsx`, cPath = `${pullId}/${stamp}_GHL_IMPORT.csv`;
    await putObject("outputs", xPath, xbuf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    await putObject("outputs", cPath, csv, "text/csv");
    report.files = { results: xPath, import_csv: cPath };

    const [batch] = await upsert("export_batches", [{ pull_id: pullId, upload_id: upload.upload_id, approved: false, counts: report }], { returning: true });
    await upsert("export_rows", [
      ...fresh.map((i) => ({ batch_id: batch.batch_id, property_id: i.x.pid, phone: i.phone, bucket: "new", reason: null })),
      ...existingL.map((i) => ({ batch_id: batch.batch_id, property_id: i.x.pid, phone: i.phone, bucket: "in_texting", reason: i.ghl?.contact_id || i.where })),
      ...dupL.map((i) => ({ batch_id: batch.batch_id, property_id: i.x.pid, phone: i.phone, bucket: "dup_in_list", reason: keeper.get(i.phone) || null })),
      ...held.map((i) => ({ batch_id: batch.batch_id, property_id: i.x.pid, phone: i.phone, bucket: "held", reason: i.reason })),
      ...excluded.map((i) => ({ batch_id: batch.batch_id, property_id: i.x.pid, phone: i.phone || i.raw, bucket: "excluded", reason: i.reason })),
    ]);
    // stays a draft: the pull is marked done and the next pull is scheduled only when the export is confirmed (lib/uploads.ts)
    await update("uploads", { upload_id: `eq.${upload.upload_id}` }, { report });
    return report;
  } catch (e) {
    // a failed run must not count anywhere: void what it wrote, put the pull back, and let the same file be retried
    await voidPullRows(pullId, new Date().toISOString()).catch(() => {});
    await update("export_batches", { upload_id: `eq.${upload.upload_id}` }, { voided_at: new Date().toISOString() }).catch(() => {});
    await update("pull_tasks", { pull_id: `eq.${pullId}` }, { status: prevStatus }).catch(() => {});
    await update("uploads", { upload_id: `eq.${upload.upload_id}` }, { file_sha256: null, status: "failed", report: { error: String(e) } }).catch(() => {});
    throw e;
  }
}
