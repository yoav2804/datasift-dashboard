export function norm(v: any): string | null {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (s.endsWith(".0")) s = s.slice(0, -2);
  let d = s.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  if (d.length !== 10) return null;
  if ("01".includes(d[0]) || "01".includes(d[3])) return null;
  if (["555", "800", "888", "877", "866", "855", "844", "833", "900"].includes(d.slice(0, 3))) return null;
  if (new Set(d).size === 1) return null;
  return "+1" + d;
}
