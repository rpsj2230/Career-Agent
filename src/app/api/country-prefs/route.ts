import { NextResponse } from "next/server";
import { logConfig } from "@/lib/activity-helpers";
import { COUNTRY_NAME_MAP } from "@/lib/countries";
import { CountryPrefInput, dedupeList } from "@/lib/country-prefs";
import { deleteCountryPref, saveCountryPref } from "@/lib/country-prefs-store";
import { isMissingSchemaError } from "@/lib/schema";

/** Create or update the criteria for one country. */
export async function PUT(request: Request) {
  const parsed = CountryPrefInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, { status: 400 });
  const p = { ...parsed.data, titles: dedupeList(parsed.data.titles), industries: dedupeList(parsed.data.industries), locations: dedupeList(parsed.data.locations) };
  try {
    await saveCountryPref(p);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: isMissingSchemaError(msg) ? "The database update has not been applied yet. Open System to apply it." : `Could not save: ${msg}` }, { status: isMissingSchemaError(msg) ? 409 : 500 });
  }
  const name = COUNTRY_NAME_MAP[p.country] ?? p.country.toUpperCase();
  await logConfig(`Country settings saved: ${name}`, { country: p.country, enabled: p.enabled, titles: p.titles, industries: p.industries, locations: p.locations, remote: p.remote, salary: [p.salary_min, p.salary_max, p.currency], work_authorisation: p.work_authorisation });
  return NextResponse.json({ ok: true, note: `${name} saved` });
}

export async function DELETE(request: Request) {
  const country = new URL(request.url).searchParams.get("country") ?? "";
  if (!/^[a-z]{2}$/.test(country)) return NextResponse.json({ error: "country required" }, { status: 400 });
  try { await deleteCountryPref(country); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Could not remove" }, { status: 500 }); }
  await logConfig(`Country removed: ${COUNTRY_NAME_MAP[country] ?? country.toUpperCase()}`, { country });
  return NextResponse.json({ ok: true, note: "Removed" });
}
