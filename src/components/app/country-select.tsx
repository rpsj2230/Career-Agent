import Link from "next/link";
import { Button } from "@/components/ui/button";
import { countryLabel } from "@/lib/filters";

const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Narrow a summary screen to one country; the choice lives in the URL so reports and dashboards can be linked. */
export function CountrySelect({ action, country, options }: { action: string; country?: string; options: { key: string; n?: number }[] }) {
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs text-muted-foreground">Country
        <select name="country" defaultValue={country ?? ""} className={selectClass}>
          <option value="">All countries</option>
          {options.map((c) => <option key={c.key} value={c.key}>{countryLabel(c.key)}{c.n ? ` (${c.n})` : ""}</option>)}
        </select>
      </label>
      <Button type="submit" size="sm">Apply</Button>
      <Button asChild type="button" size="sm" variant="ghost"><Link href={action}>Clear</Link></Button>
    </form>
  );
}
