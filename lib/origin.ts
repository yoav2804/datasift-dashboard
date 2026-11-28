// Where a list's data originally comes from, in four groups.
// A source row can set origin_type explicitly (provider | municipality | county | court); otherwise it is inferred from its id and name.
// Unknown sources count as an external provider, since every list without a source is a PropStream / DataSift pull.
export type Origin = "provider" | "municipality" | "county" | "court";

export const ORIGINS: { key: Origin; label: string; examples: string }[] = [
  { key: "provider", label: "External provider", examples: "PropStream, DataSift" },
  { key: "municipality", label: "City / municipality", examples: "code violations, condemned, city taxes" },
  { key: "county", label: "County offices", examples: "Recorder, Collector, tax sale, notices" },
  { key: "court", label: "Courts", examples: "probate, evictions (Case.net)" },
];

export function originOf(src: any): Origin {
  const set = String(src?.origin_type || "").toLowerCase();
  if (ORIGINS.some((o) => o.key === set)) return set as Origin;
  const id = String(src?.source_id || "").toUpperCase();
  const name = String(src?.name || "").toLowerCase();
  if (!id || id === "PROPSTREAM" || id === "DATASIFT" || /propstream|datasift|siftmap/.test(name)) return "provider";
  if (/probate|evict|circuit|court|case\.?net|divorce|bankrupt/.test(name)) return "court";
  if (/code|condemn|vacant build|inspection|311|nuisance|rental|city of|municipal|city tax/.test(name)) return "municipality";
  return "county";   // recorder, collector, tax sale / delinquent, foreclosure notices
}

export const originLabel = (o: Origin) => ORIGINS.find((x) => x.key === o)!.label;
