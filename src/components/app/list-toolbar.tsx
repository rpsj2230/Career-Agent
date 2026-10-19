import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { countryLabel } from "@/lib/filters";
import { portalLabel } from "@/lib/jobs/portal";
import { LIFECYCLES, LIFECYCLE_LABEL, ROUTE_KINDS, ROUTE_LABEL, STAGES, type Pill, type StageKey } from "@/lib/list-query";

type Opt = { key: string; n?: number };
const field = "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export type ToolbarQuery = {
  stages: StageKey[]; portals: string[]; countries: string[]; methods: string[]; q?: string; sort: string; dir: "asc" | "desc";
  scoreMin?: number; scoreMax?: number; from?: string; to?: string; sentFrom?: string; sentTo?: string; lifecycles?: string[];
};

/**
 * Stage chips with live counts, search, sort, a full filter panel and removable pills.
 * A plain GET form plus links: everything lives in the URL, so it survives refresh and can be bookmarked or sent to someone.
 */
export function ListToolbar(props: {
  kind: "jobs" | "apps";
  action: string;
  chips: { key: StageKey; count: number }[];
  presets: { label: string; stages: StageKey[]; count: number }[];
  q: ToolbarQuery;
  sorts: Record<string, { label: string; dir: "asc" | "desc" }>;
  portals: Opt[];
  countries: Opt[];
  pills: (Pill & { href: string })[];
  hrefs: { all: string; stage: Record<string, string>; preset: string[]; clear: string };
  total: number;
  totalAll: number;
  showing: string;
}) {
  const q = props.q;
  const activeAll = q.stages.length === 0;
  const chip = (active: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium hover:bg-accent ${active ? "border-foreground bg-accent" : "text-muted-foreground"}`;
  const open = q.portals.length + q.countries.length + q.methods.length + (q.scoreMin !== undefined ? 1 : 0) + (q.scoreMax !== undefined ? 1 : 0) + (q.from ? 1 : 0) + (q.to ? 1 : 0) + (q.sentFrom ? 1 : 0) + (q.sentTo ? 1 : 0) + (q.lifecycles?.length ?? 0) > 0;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2" aria-label="Pipeline stage">
        <Link href={props.hrefs.all} className={chip(activeAll)}>All <span className="text-muted-foreground">{props.chips.reduce((n, c) => n + c.count, 0).toLocaleString("en-US")}</span></Link>
        {props.presets.map((p, i) => {
          const active = p.stages.length === q.stages.length && p.stages.every((s) => q.stages.includes(s));
          return <Link key={p.label} href={props.hrefs.preset[i]} className={`${chip(active)} ${p.count > 0 ? "border-sky-500" : ""}`} title="Everything waiting for you">★ {p.label} <span className="font-semibold">{p.count.toLocaleString("en-US")}</span></Link>;
        })}
        {props.chips.map((c) => (
          <Link key={c.key} href={props.hrefs.stage[c.key]} className={chip(q.stages.length === 1 && q.stages[0] === c.key)} title={STAGES[c.key].hint}>
            {STAGES[c.key].label} <span className={c.count > 0 ? "font-semibold text-foreground" : "text-muted-foreground"}>{c.count.toLocaleString("en-US")}</span>
          </Link>
        ))}
      </div>

      <form method="get" action={props.action} className="grid gap-3 rounded-md border p-3">
        {q.stages.map((s) => <input key={s} type="hidden" name="stage" value={s} />)}
        {q.stages.length === 0 && props.kind === "jobs" && <input type="hidden" name="stage" value="all" />}
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">Search
            <Input name="q" defaultValue={q.q ?? ""} placeholder={props.kind === "jobs" ? "title, company or location" : "title or company"} className="h-9 w-64" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">Sort by
            <select name="sort" defaultValue={q.sort} className={field}>{Object.entries(props.sorts).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">Order
            <select name="dir" defaultValue={q.dir} className={field}><option value="desc">Highest / newest first</option><option value="asc">Lowest / oldest / A to Z first</option></select>
          </label>
          <Button type="submit" size="sm">Apply</Button>
          <Button asChild type="button" size="sm" variant="ghost"><Link href={props.hrefs.clear}>Clear all</Link></Button>
        </div>

        <details open={open}>
          <summary className="cursor-pointer text-sm font-medium">More filters{open ? " (some applied)" : ""}</summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <fieldset className="grid gap-1 text-sm"><legend className="mb-1 text-xs font-medium text-muted-foreground">Portal</legend>
              <div className="grid max-h-40 gap-1 overflow-auto">{props.portals.length === 0 ? <span className="text-xs text-muted-foreground">none yet</span> : props.portals.map((p) => (
                <label key={p.key} className="flex items-center gap-2"><input type="checkbox" name="portal" value={p.key} defaultChecked={q.portals.includes(p.key)} /> {portalLabel(p.key)}{p.n ? <span className="text-xs text-muted-foreground">({p.n})</span> : null}</label>
              ))}</div>
            </fieldset>
            <fieldset className="grid gap-1 text-sm"><legend className="mb-1 text-xs font-medium text-muted-foreground">Country</legend>
              <div className="grid max-h-40 gap-1 overflow-auto">{props.countries.length === 0 ? <span className="text-xs text-muted-foreground">none yet</span> : props.countries.map((c) => (
                <label key={c.key} className="flex items-center gap-2"><input type="checkbox" name="country" value={c.key} defaultChecked={q.countries.includes(c.key)} /> {countryLabel(c.key)}{c.n ? <span className="text-xs text-muted-foreground">({c.n})</span> : null}</label>
              ))}</div>
            </fieldset>
            <fieldset className="grid gap-1 text-sm"><legend className="mb-1 text-xs font-medium text-muted-foreground">How it is applied</legend>
              {ROUTE_KINDS.map((m) => <label key={m} className="flex items-center gap-2"><input type="checkbox" name="method" value={m} defaultChecked={q.methods.includes(m)} /> {ROUTE_LABEL[m]}</label>)}
            </fieldset>
            {props.kind === "jobs" ? (
              <>
                <div className="grid gap-1 text-sm"><span className="text-xs font-medium text-muted-foreground">Fit score (0 to 100)</span>
                  <div className="flex items-center gap-2"><Input name="score_min" type="number" min={0} max={100} defaultValue={q.scoreMin ?? ""} placeholder="from" className="h-9 w-24" /> to <Input name="score_max" type="number" min={0} max={100} defaultValue={q.scoreMax ?? ""} placeholder="to" className="h-9 w-24" /></div></div>
                <div className="grid gap-1 text-sm"><span className="text-xs font-medium text-muted-foreground">Date found</span>
                  <div className="flex items-center gap-2"><Input name="from" type="date" defaultValue={q.from ?? ""} className="h-9" /> to <Input name="to" type="date" defaultValue={q.to ?? ""} className="h-9" /></div></div>
              </>
            ) : (
              <>
                <fieldset className="grid gap-1 text-sm"><legend className="mb-1 text-xs font-medium text-muted-foreground">Outcome</legend>
                  {LIFECYCLES.map((l) => <label key={l} className="flex items-center gap-2"><input type="checkbox" name="lifecycle" value={l} defaultChecked={q.lifecycles?.includes(l)} /> {LIFECYCLE_LABEL[l]}</label>)}
                </fieldset>
                <div className="grid gap-1 text-sm"><span className="text-xs font-medium text-muted-foreground">Date prepared</span>
                  <div className="flex items-center gap-2"><Input name="from" type="date" defaultValue={q.from ?? ""} className="h-9" /> to <Input name="to" type="date" defaultValue={q.to ?? ""} className="h-9" /></div></div>
                <div className="grid gap-1 text-sm"><span className="text-xs font-medium text-muted-foreground">Date sent</span>
                  <div className="flex items-center gap-2"><Input name="sent_from" type="date" defaultValue={q.sentFrom ?? ""} className="h-9" /> to <Input name="sent_to" type="date" defaultValue={q.sentTo ?? ""} className="h-9" /></div></div>
              </>
            )}
          </div>
          <div className="mt-3"><Button type="submit" size="sm">Apply filters</Button></div>
        </details>
      </form>

      {props.pills.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Active filters">
          <span className="text-muted-foreground">Filtered by:</span>
          {props.pills.map((p) => <Link key={p.label} href={p.href} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 hover:bg-accent" title="Remove this filter">{p.label} <span aria-hidden>×</span></Link>)}
          <Link href={props.hrefs.clear} className="underline">Clear all</Link>
        </div>
      )}
      <p className="text-sm text-muted-foreground">{props.showing}{props.total !== props.totalAll ? ` · filtered from ${props.totalAll.toLocaleString("en-US")}` : ""}</p>
    </div>
  );
}
