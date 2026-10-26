// Data Manager: process one PropStream export for one Pull ID. Writes to Supabase only, never to GHL.
import * as XLSX from "xlsx";
import crypto from "crypto";
import { select, upsert, update, putObject } from "./sb";
import { norm } from "./phones";

const COUNTY_FIPS: Record<string, string> = { "SAINT LOUIS CITY": "29510", "ST LOUIS CITY": "29510", "SAINT LOUIS": "29189", "ST LOUIS": "29189", "SAINT CHARLES": "29183", "ST CHARLES": "29183" };
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

export async function processFile(buf: ArrayBuffer, filename: string, pullId: string, opts: { market?: string; notes?: string } = {}) {
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

  const marketOf = (r: any) => opts.market || COUNTY_FIPS[clean(r["County"])] || null;
  const addrKey = (r: any) => `${clean(r["Address"])}|${clean(r["Unit #"])}|${z5(r["Zip"])}`;

  // pull task
  let pt = (await select("pull_tasks", { pull_id: `eq.${pullId}` }))[0];
  if (!pt) {
    const mk = opts.market || RECS.map(marketOf).find(Boolean) || null;
    await upsert("pull_tasks", [{ pull_id: pullId, market_fips: mk, source_id: "PROPSTREAM", status: "pulled", notes: opts.notes || "created at upload" }]);
    pt = (await select("pull_tasks", { pull_id: `eq.${pullId}` }))[0];
  }
  const profileId = pt.profile_id;
  const [upload] = await upsert("uploads", [{ pull_id: pullId, filename, file_sha256: sha, row_count: RECS.length }], { returning: true });

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

    // source rows are kept: the first row as raw, every other row that merged into this property under _merged_rows
    const rawOf = (r: any) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null));
    await upsert("property_pulls", props.map((x) => ({ property_id: x.pid, pull_id: pullId, upload_id: upload.upload_id, was_new: x.wasNew,
      raw: { ...rawOf(x.r), ...(x.rows.length > 1 ? { _source_rows: x.rows.length, _apns: x.apns, _merged_rows: x.rows.slice(1).map((y: any) => rawOf(y.r)) } : {}) } })),
      { onConflict: "property_id,pull_id" });
    // list lifespan: which of these properties were already on THIS list in an earlier pull
    const seenOnList = new Set<string>(); let lastListPull: any = null;
    if (profileId) {
      for (const r of await inChunks(props.map((x) => x.pid), 150, (part) => select("property_profiles", { profile_id: `eq.${profileId}`, property_id: `in.(${part.join(",")})`, select: "property_id,first_pull_id" }))) if (r.first_pull_id !== pullId) seenOnList.add(r.property_id);
      lastListPull = (await select("pull_tasks", { profile_id: `eq.${profileId}`, zip_group: `eq.${pt.zip_group}`, status: "eq.processed", order: "completed_date.desc", select: "pull_id,completed_date" }))[0];
    }
    if (profileId) await upsert("property_profiles", props.map((x) => ({ property_id: x.pid, profile_id: profileId, first_pull_id: pullId })), { onConflict: "property_id,profile_id", ignore: true });

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
    const items: any[] = [], excluded: any[] = [];
    for (const x of props) { const here = new Set<string>(); for (const y of x.rows) {
      const r = y.r; const lit = x.rows.some((z: any) => String(z.r["Litigator"] || "").toLowerCase() === "yes");
      for (let s = 1; s <= 5; s++) {
        const raw = r[`Phone ${s}`]; if (!raw) continue;
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
    for (const h of await inChunks(allp, 150, (part) => select("property_phones", { phone: `in.(${part.join(",")})`, select: "phone,property_id,first_pull_id" })))
      hist.set(h.phone, [...(hist.get(h.phone) || []), h]);
    const cids = Array.from(new Set(Array.from(ghl.values()).flat()));
    const gc = new Map<string, any>();
    for (const c of await inChunks(cids, 100, (part) => select("ghl_contacts", { contact_id: `in.(${part.join(",")})`, select: "contact_id,name,dnd,date_added,raw" }))) gc.set(c.contact_id, c);

    await upsert("phones", allp.map((p) => { const its = items.filter((i) => i.phone === p);
      return { phone: p, last_type: its[0].type, propstream_dnc: its.some((i) => i.dnc), litigator: its.some((i) => i.lit) }; }), { onConflict: "phone" });

    const batchProps = new Map<string, Set<string>>();
    for (const i of items) { if (!batchProps.has(i.phone)) batchProps.set(i.phone, new Set()); batchProps.get(i.phone)!.add(i.x.pid); }

    const fresh: any[] = [], existingL: any[] = [], review: any[] = [], held: any[] = [];
    for (const i of items) {
      const x = i.x, p = i.phone;
      if (!isResidential(x.r["Property Type"])) { excluded.push({ ...i, reason: `non-residential (${x.r["Property Type"]})` }); continue; }
      if (i.lit) { excluded.push({ ...i, reason: "litigator flag on owner" }); continue; }
      if (String(i.type || "").toLowerCase() === "landline") { excluded.push({ ...i, reason: "landline" }); continue; }
      if (ghl.has(p)) {
        const cs = ghl.get(p)!.map((c) => gc.get(c)).filter(Boolean);
        const same = cs.filter((c) => !c.raw?.address1 || street(c.raw.address1) === street(x.r["Address"]));
        if (same.length) { existingL.push({ ...i, ghl: same[0] }); continue; }
        review.push({ ...i, reason: "in_ghl_other_property", ghl: cs[0] }); continue;
      }
      const otherHist = (hist.get(p) || []).filter((h) => h.property_id !== x.pid);
      const sameHist = (hist.get(p) || []).filter((h) => h.property_id === x.pid && h.first_pull_id !== pullId);
      if (sameHist.length && !otherHist.length) { existingL.push({ ...i, ghl: null, priorPull: sameHist[0].first_pull_id }); continue; }
      if (otherHist.length) { review.push({ ...i, reason: "shared_in_history", other: otherHist }); continue; }
      if (batchProps.get(p)!.size > 1) { review.push({ ...i, reason: "shared_in_batch" }); continue; }
      fresh.push(i);
    }

    await upsert("property_phones", items.map((i) => ({ property_id: i.x.pid, phone: i.phone, owner_id: oid.get(i.okey || i.x.okey), slot: i.slot, phone_type: i.type, propstream_dnc: i.dnc, first_pull_id: pullId })),
      { onConflict: "property_id,phone", ignore: true });

    const pidX = new Map(props.map((x) => [x.pid, x]));
    const histAddr = new Map<string, string>();
    const histIds = Array.from(new Set(review.flatMap((i) => (i.other || []).map((o: any) => o.property_id))));
    for (const p of await inChunks(histIds, 100, (part) => select("properties", { property_id: `in.(${part.join(",")})`, select: "property_id,address,city,zip" })))
      histAddr.set(p.property_id, `${p.address}, ${p.city} ${p.zip}`);
    for (const i of review) {
      const a = i.x.r;
      if (i.reason === "in_ghl_other_property") {
        const g = i.ghl.raw || {};
        i.nameMatch = !!clean(g.lastName) && clean(g.lastName) === clean(a["Owner 1 Last Name"]); i.mailMatch = null; i.otherAddr = g.address || "";
      } else if (i.reason === "shared_in_history") {
        i.otherAddr = histAddr.get(i.other[0].property_id) || ""; i.nameMatch = null; i.mailMatch = null;
      } else {
        const o = Array.from(batchProps.get(i.phone)!).filter((q) => q !== i.x.pid).map((q) => pidX.get(q)).filter(Boolean)[0];
        i.nameMatch = o ? clean(a["Owner 1 Last Name"]) === clean(o.r["Owner 1 Last Name"]) : null;
        i.mailMatch = o ? clean(a["Mailing Address"]) === clean(o.r["Mailing Address"]) : null; i.otherAddr = o?.r["Address"] || "";
      }
    }
    await upsert("review_cases", review.map((i) => ({ phone: i.phone, reason: i.reason, ghl_contact_id: i.ghl?.contact_id || null, new_property_id: i.x.pid,
      owner_name_match: i.nameMatch, mailing_match: i.mailMatch, pull_id: pullId, original_property_id: i.other?.[0]?.property_id || null,
      notes: i.otherAddr ? `Other property: ${i.otherAddr}` : null })), { onConflict: "phone,new_property_id", ignore: true });

    // ---------- outputs ----------
    const base = (i: any) => { const r = i.x.r; return { "Property ID": i.x.pid, Address: r["Address"], City: r["City"], Zip: z5(r["Zip"]),
      Owner: [r["Owner 1 First Name"], r["Owner 1 Last Name"]].filter(Boolean).join(" "),
      Mailing: [r["Mailing Address"], r["Mailing City"], r["Mailing State"], z5(r["Mailing Zip"])].filter(Boolean).join(" "),
      Phone: i.phone || i.raw, Type: i.type, Slot: i.slot, "PropStream DNC": i.dnc ? "Yes" : "", "Property New To Us": i.x.wasNew ? "Yes" : "No" }; };
    const WHY: any = { in_ghl_other_property: "Number already in GHL on a different property", shared_in_history: "Number seen before on a different property", shared_in_batch: "Same number on 2+ properties in this file" };
    const outNew = fresh.map(base);
    const outExist = existingL.map((i) => ({ ...base(i), Where: i.ghl ? "In GHL" : `Already in our database (pull ${i.priorPull}), not in GHL yet`,
      "GHL Contact ID": i.ghl?.contact_id || "", "GHL Name": i.ghl?.name || "", "GHL DND": i.ghl ? (i.ghl.dnd ? "Yes" : "No") : "", "In GHL Since": (i.ghl?.date_added || "").slice(0, 10) }));
    const outRev = review.map((i) => ({ ...base(i), Why: WHY[i.reason], "Other Property": i.otherAddr || "", "GHL Contact ID": i.ghl?.contact_id || "",
      "First In GHL": (i.ghl?.date_added || "").slice(0, 10), "Same Owner Last Name": i.nameMatch === null ? "" : i.nameMatch ? "Yes" : "No",
      "Same Mailing Address": i.mailMatch === null || i.mailMatch === undefined ? "" : i.mailMatch ? "Yes" : "No" }));
    const outExc = excluded.map((i) => ({ ...base(i), Reason: i.reason }));
    const outHeld = held.map((i) => ({ ...base(i), Reason: i.reason }));

    // import file: new numbers AND duplicates (GHL decides on import). Each phone keeps its status.
    const imp = new Map<string, any[]>();
    const status = (i: any, s: string) => ({ ...i, st: s });
    for (const i of [...fresh.map((i) => status(i, "new")), ...existingL.map((i) => status(i, i.ghl ? "in_ghl" : "seen_before")), ...review.map((i) => status(i, "review"))])
      imp.set(i.x.pid, [...(imp.get(i.x.pid) || []), i]);
    let dupRows = 0, trapRows = 0;
    const outImp: any[] = [];
    imp.forEach((ph0, pid) => {
      const r = ph0[0].x.r;
      // a number GHL already has as a main Phone goes first, so GHL matches the existing contact instead of creating a duplicate
      const ph = ph0.sort((a, b) => (ghlMain.has(b.phone) ? 1 : 0) - (ghlMain.has(a.phone) ? 1 : 0) || a.slot - b.slot).slice(0, 4);
      const isDup = ph.some((q) => q.st !== "new");
      const trap = ph.some((q) => ghl.has(q.phone)) && !ghlMain.has(ph[0].phone);
      if (isDup) dupRows++; if (trap) trapRows++;
      const row: any = { "First Name": r["Owner 1 First Name"] || "", "Last Name": r["Owner 1 Last Name"] || "", Phone: ph[0].phone, "Phone Type": ph[0].type,
        "Phone 2": ph[1]?.phone || "", "Phone 2 Type": ph[1]?.type || "", "Phone 3": ph[2]?.phone || "", "Phone 3 Type": ph[2]?.type || "", "Phone 4": ph[3]?.phone || "", "Phone 4 Type": ph[3]?.type || "",
        Address: r["Address"], City: r["City"], State: r["State"], "Postal Code": z5(r["Zip"]),
        "Property Address For AI": `${r["Address"]}, ${r["City"]}, ${r["State"]} ${z5(r["Zip"])}`,
        "DS Property ID": pid, "DS Pull ID": pullId, "DS Profile": profileId || "", "DS ZIP Group": pt.zip_group || "", "DS Market": ph0[0].x.market || "",
        "DS Status": !isDup ? "New" : trap ? "Duplicate: GHL may create a 2nd contact" : ph.some((q) => q.st === "in_ghl") ? "Duplicate: already in GHL" : ph.some((q) => q.st === "review") ? "Duplicate: multi-property" : "Duplicate: seen in earlier pull" };
      outImp.push(row);
    });

    // refresh rate -> when to pull this list again
    const newToList = props.filter((x) => !seenOnList.has(x.pid)).length;
    const freshShare = props.length ? newToList / props.length : 1;
    let nextDays = 30, refreshNote = "First pull of this list. Pull it again in 30 days to measure how fast it refreshes.";
    if (lastListPull && seenOnList.size > 0) {
      const gap = Math.max(7, (Date.now() - Date.parse(lastListPull.completed_date)) / 864e5);
      const perMonth = (freshShare * 30) / Math.max(gap, 30);  // never extrapolate up from a short gap
      nextDays = perMonth >= 0.5 ? 30 : perMonth >= 0.25 ? 60 : perMonth >= 0.1 ? 90 : 180;
      refreshNote = `${Math.round(freshShare * 100)}% of this list was new after ${Math.round(gap)} days (about ${Math.round(perMonth * 100)}% a month), so next pull in ${nextDays} days.`;
    }
    const nextDate = new Date(Date.now() + nextDays * 864e5).toISOString().slice(0, 10);

    const zipDist: Record<string, number> = {};
    for (const x of props) { const z = z5(x.r["Zip"]); zipDist[z] = (zipDist[z] || 0) + 1; }
    const report: any = { pull_id: pullId, file: filename, rows_in_file: RECS.length, duplicate_rows_in_file: dupInFile, unique_properties: props.length,
      net_new_properties: props.filter((x) => x.wasNew).length, already_known_properties: props.filter((x) => !x.wasNew).length,
      non_residential_properties: props.filter((x) => !isResidential(x.r["Property Type"])).length,
      properties_with_any_phone: new Set(items.map((i) => i.x.pid)).size, unique_valid_phones: allp.length, property_phone_pairs: items.length,
      invalid_numbers: excluded.filter((e) => e.reason === "invalid number").length, landlines: excluded.filter((e) => e.reason === "landline").length,
      litigator_numbers: excluded.filter((e) => e.reason.startsWith("litigator")).length, non_residential_numbers: excluded.filter((e) => e.reason.startsWith("non-residential")).length,
      held_propstream_dnc: held.length, already_in_ghl: existingL.filter((i) => i.ghl).length, already_in_our_database_not_ghl: existingL.filter((i) => !i.ghl).length,
      existing_ghl_dnd: existingL.filter((i) => i.ghl?.dnd).length, multi_property_review: review.length, new_numbers: fresh.length, import_rows: outImp.length,
      import_rows_new: outImp.length - dupRows, import_rows_duplicates: dupRows, import_rows_may_create_second_contact: trapRows,
      properties_new_to_list: newToList, properties_already_on_list: props.length - newToList, pct_new_to_list: Math.round(freshShare * 1000) / 10,
      pct_already_known: props.length ? Math.round((props.filter((x) => !x.wasNew).length / props.length) * 1000) / 10 : 0,
      refresh_note: profileId ? refreshNote : "", next_pull_date: profileId ? nextDate : null, zip_distribution: zipDist };

    const out = XLSX.utils.book_new();
    const add = (name: string, data: any[]) => XLSX.utils.book_append_sheet(out, data.length ? XLSX.utils.json_to_sheet(data) : XLSX.utils.aoa_to_sheet([["(none)"]]), name);
    add("Pull Report", Object.entries(report).map(([k, v]) => ({ Metric: k.replace(/_/g, " "), Value: typeof v === "object" ? JSON.stringify(v) : v })));
    add("GHL Import", outImp); add("New Contacts", outNew); add("Existing GHL", outExist); add("Multi-Property Review", outRev); add("Held DNC", outHeld); add("Excluded", outExc);
    const xbuf = XLSX.write(out, { type: "buffer", bookType: "xlsx" });
    const csv = outImp.length ? XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(outImp)) : "";
    const stamp = NOW.slice(0, 19).replace(/[:T]/g, "-");
    const xPath = `${pullId}/${stamp}_results.xlsx`, cPath = `${pullId}/${stamp}_GHL_IMPORT.csv`;
    await putObject("outputs", xPath, xbuf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    await putObject("outputs", cPath, csv, "text/csv");
    report.files = { results: xPath, import_csv: cPath };

    const [batch] = await upsert("export_batches", [{ pull_id: pullId, counts: report }], { returning: true });
    await upsert("export_rows", [
      ...fresh.map((i) => ({ batch_id: batch.batch_id, property_id: i.x.pid, phone: i.phone, bucket: "new", reason: null })),
      ...existingL.map((i) => ({ batch_id: batch.batch_id, property_id: i.x.pid, phone: i.phone, bucket: "existing", reason: i.ghl?.contact_id || `prior pull ${i.priorPull}` })),
      ...review.map((i) => ({ batch_id: batch.batch_id, property_id: i.x.pid, phone: i.phone, bucket: "review", reason: i.reason })),
      ...held.map((i) => ({ batch_id: batch.batch_id, property_id: i.x.pid, phone: i.phone, bucket: "held", reason: i.reason })),
      ...excluded.map((i) => ({ batch_id: batch.batch_id, property_id: i.x.pid, phone: i.phone || i.raw, bucket: "excluded", reason: i.reason })),
    ]);
    await update("uploads", { upload_id: `eq.${upload.upload_id}` }, { report });
    await update("pull_tasks", { pull_id: `eq.${pullId}` }, { status: "processed", completed_date: NOW.slice(0, 10), rows_pulled: RECS.length,
      net_new_properties: report.net_new_properties, contacts_generated: outImp.length,
      next_pull_date: profileId ? nextDate : null });
    if (profileId) await upsert("pull_tasks", [{ pull_id: `${pullId.replace(/-\d{8}$/, "")}-${nextDate.replace(/-/g, "")}`, market_fips: pt.market_fips, profile_id: profileId,
      zip_group: pt.zip_group, zips: pt.zips, source_id: pt.source_id, priority: pt.priority, planned_date: nextDate, status: "planned", notes: `recycle: ${refreshNote}` }],
      { onConflict: "pull_id", ignore: true });
    return report;
  } catch (e) {
    // let the same file be retried after a failure
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/uploads?upload_id=eq.${upload.upload_id}`, { method: "PATCH",
      headers: { apikey: process.env.SUPABASE_SERVICE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ file_sha256: null, report: { error: String(e) } }) });
    throw e;
  }
}
