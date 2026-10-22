import Link from "next/link";
import { ActionButton } from "@/components/app/action-button";
import { ScopeToggles } from "@/components/app/scope-toggles";
import { TemplateMap } from "@/components/app/template-map";
import { DEFAULT_SCOPE, SAMPLE_PROFILE } from "@/lib/tailor/scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { countryLabel } from "@/lib/filters";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/profile/store";
import { getSetting } from "@/lib/settings";
import { buildLibrary, matchesQuery, tagsFor } from "@/lib/tailor/library";
import { getMasterInfo } from "@/lib/tailor/master-store";
import { masterAsTailored, resumeView } from "@/lib/tailor/sections";
import { STYLES, styleById } from "@/lib/tailor/template";
import { appTimezone, fmtDate } from "@/lib/time";

export const dynamic = "force-dynamic";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ResumesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = one(sp.q)?.slice(0, 80) ?? "";
  const style = styleById(one(sp.style));
  const [profile, master, templates, scope] = await Promise.all([getProfile(), getMasterInfo(), getSetting("resume_templates").catch(() => ({})), getSetting("tailoring_scope")]);
  const docs = await db().from("documents").select("id,job_id,version,storage_path,created_at,verification,job:jobs(title,company,country)").eq("kind", "resume").order("created_at", { ascending: false }).limit(600);
  const apps = await db().from("applications").select("job_id,lifecycle").limit(2000);
  const lifecycle = new Map(((apps.data ?? []) as { job_id: string; lifecycle: string }[]).map((a) => [a.job_id, a.lifecycle]));
  const all = buildLibrary(((docs.data ?? []) as unknown as Parameters<typeof buildLibrary>[0]), lifecycle);
  const rows = all.filter((r) => matchesQuery(r, q));
  const tz = appTimezone();
  const hasProfile = profile.experience.length > 0;

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Resumes</h1>
        <p className="text-sm text-muted-foreground">Your master resume, the template every resume is laid out in, and every resume the agent has made, saved with tags so a similar job can reuse one instead of writing a new one.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Master resume</CardTitle><CardDescription>The resume file you uploaded on the Profile page, kept exactly as it was. If no tailored resume can be made for a job (for example every model is down), this file is attached instead, so an application is never left without a resume. Without an uploaded file, your profile laid out in the template below is used.</CardDescription></CardHeader>
        <CardContent className="grid gap-3">
          {master ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge className="bg-green-600 text-white">Uploaded</Badge>
              <span className="font-medium">{master.name}</span><span className="text-muted-foreground">{Math.round(master.size / 1024)} KB, {fmtDate(master.uploaded_at, tz)}</span>
              <Button asChild size="sm" variant="outline"><a href="/api/resumes/master?file=original">Download</a></Button>
            </div>
          ) : <p className="text-sm"><Badge variant="secondary">None yet</Badge> Upload your master resume on the <Link className="underline" href="/profile">Profile</Link> page.</p>}
          <p className="text-xs text-muted-foreground">The master resume is uploaded once, on the <Link className="underline" href="/profile">Profile</Link> page. That one upload fills your profile, builds the template below and is kept here as the fallback. To change it, import a new file there.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resume template</CardTitle>
          <CardDescription>One fixed, plain single-column layout that applicant tracking systems read correctly: the same fonts, spacing and order every time. Only a small named style changes by country (page size, spelling, the summary&apos;s heading, how many bullets per role). Below is the master resume in the selected style, with each part marked as fixed or changing per job.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {STYLES.map((s) => <Button key={s.id} asChild size="sm" variant={s.id === style.id ? "default" : "outline"}><Link href={`/resumes?style=${s.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>{s.label}</Link></Button>)}
          </div>
          <p className="text-xs text-muted-foreground">Countries using this style: {Object.entries(templates as Record<string, string>).filter(([, id]) => id === style.id).map(([c]) => countryLabel(c)).join(", ") || "by default, the regions it is designed for (change a country&apos;s style on the Countries page)"}.</p>
          <TemplateMap view={resumeView(hasProfile ? profile : SAMPLE_PROFILE, masterAsTailored(hasProfile ? profile : SAMPLE_PROFILE), style)} style={style} scope={{ ...DEFAULT_SCOPE, ...scope }} sample={!hasProfile} />
          {hasProfile && <div><Button asChild variant="outline" size="sm"><a href={`/api/resumes/master?file=template&style=${style.id}`}>Download this as DOCX</a></Button></div>}
          <div className="grid gap-1">
            <div className="text-sm font-medium">What changes for each job</div>
            <p className="text-xs text-muted-foreground">Everything marked Fixed is identical in every resume: your name and contact details, each employer, your job title there, its dates and location, your education and certifications. The agent only rewrites the parts you leave switched on, using the job description, and never adds a skill, employer, number or title you do not have.</p>
            <ScopeToggles scope={{ ...DEFAULT_SCOPE, ...scope }} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Saved resumes ({all.length})</CardTitle><CardDescription>Every resume the agent made, newest first. When a new job is close to one of these, the agent reuses or lightly adapts it instead of writing a new one (fewer model calls, same checks). Tags show the role, country, style, how it was made and how the application went.</CardDescription></CardHeader>
        <CardContent className="grid gap-3">
          <form method="get" action="/resumes" className="flex gap-2">
            <Input name="q" defaultValue={q} placeholder="Search by role, company, country or tag" className="max-w-sm" />
            {one(sp.style) && <input type="hidden" name="style" value={style.id} />}
            <Button type="submit" size="sm">Search</Button><Button asChild size="sm" variant="ghost"><Link href="/resumes">Clear</Link></Button>
          </form>
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">{all.length === 0 ? "No resumes yet. They appear here when the agent prepares an application." : "No resume matches that search."}</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Made for</TableHead><TableHead>Tags</TableHead><TableHead>When</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.documentId}>
                    <TableCell className="whitespace-normal"><div className="font-medium">{r.title}</div><div className="text-xs text-muted-foreground">{r.company}{r.country ? ` · ${countryLabel(r.country)}` : ""}{r.sourceTitle && r.mode !== "fresh" ? ` · from "${r.sourceTitle}"` : ""}</div></TableCell>
                    <TableCell className="whitespace-normal"><div className="flex flex-wrap gap-1">{tagsFor(r).map((t) => <Badge key={t} variant={t === "needs review" ? "destructive" : "secondary"}>{t}</Badge>)}</div></TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.createdAt, tz)} · v{r.version}</TableCell>
                    <TableCell className="whitespace-normal text-sm">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <a className="font-medium underline" href={`/resumes/view/${r.documentId}`} target="_blank" rel="noreferrer">View</a>
                        <Link className="underline" href={`/jobs/${r.jobId}`}>Job</Link>
                        <a className="underline" href={`/api/files?path=${encodeURIComponent(r.storagePath)}`}>Download DOCX</a>
                        {!r.verified && <ActionButton size="sm" variant="destructive" endpoint={`/api/documents/${r.documentId}/review`} body={{ action: "approve" }} confirm="Approve this resume although the checker flagged claims? Press View first to read them." success="Resume approved">Approve</ActionButton>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
