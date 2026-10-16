import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { countryLabel } from "@/lib/filters";
import { portalLabel } from "@/lib/jobs/portal";

type Opt = { key: string; n?: number };
const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** A plain GET form: filters live in the URL, so they survive refresh and can be bookmarked or linked from reports. */
export function FilterBar(props: {
  action: string;
  statusName: "view" | "status";
  statusOptions: { key: string; label: string }[];
  status: string;
  portals: Opt[];
  countries: Opt[];
  portal?: string;
  country?: string;
  q?: string;
}) {
  return (
    <form method="get" action={props.action} className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs text-muted-foreground">Show
        <select name={props.statusName} defaultValue={props.status} className={selectClass}>{props.statusOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">Portal
        <select name="portal" defaultValue={props.portal ?? ""} className={selectClass}>
          <option value="">All portals</option>
          {props.portals.map((p) => <option key={p.key} value={p.key}>{portalLabel(p.key)}{p.n ? ` (${p.n})` : ""}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">Country
        <select name="country" defaultValue={props.country ?? ""} className={selectClass}>
          <option value="">All countries</option>
          {props.countries.map((c) => <option key={c.key} value={c.key}>{countryLabel(c.key)}{c.n ? ` (${c.n})` : ""}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">Search
        <Input name="q" defaultValue={props.q ?? ""} placeholder="title or company" className="h-9 w-48" />
      </label>
      <Button type="submit" size="sm">Apply filters</Button>
      <Button asChild type="button" size="sm" variant="ghost"><Link href={props.action}>Clear</Link></Button>
    </form>
  );
}
