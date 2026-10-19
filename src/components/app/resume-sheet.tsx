import type { ReactNode } from "react";
import type { ResumeView } from "@/lib/tailor/sections";
import { STYLES, type ResumeStyle, type SectionId } from "@/lib/tailor/template";

/** Optional labels for the template map: which parts are fixed and which change per job. Left out, this is the plain preview. */
export type SheetTags = Partial<Record<"summary" | "headline" | "highlights" | "skills" | "bullets" | "contact" | "fixed", ReactNode>>;

/** The resume as it is printed (same view, same section order and look as the DOCX), so what you read here is what is sent. */
export function ResumeSheet({ view, style = STYLES[0], tags = {}, label = "Resume preview" }: { view: ResumeView; style?: ResumeStyle; tags?: SheetTags; label?: string }) {
  const h = (t: string, tag?: ReactNode) => (
    <div className="mt-4 flex items-center justify-between gap-2 border-b pb-0.5"><h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-[#1F3A5F] dark:text-sky-300">{t}</h4>{tag}</div>
  );
  const grouped = (title: string, gs: { group: string; items: string[] }[], tag?: ReactNode) =>
    gs.length > 0 ? <>{h(title, tag)}<ul className="ml-5 list-disc">{gs.map((g, i) => <li key={i} className="mt-0.5">{g.group && <b>{g.group}: </b>}{g.items.join(", ")}</li>)}</ul></> : null;
  const cols = (title: string, items: ReactNode[], tag?: ReactNode) =>
    items.length > 0 ? <>{h(title, tag)}<div className="mt-1 grid gap-x-6 sm:grid-cols-2">{[items.slice(0, Math.ceil(items.length / 2)), items.slice(Math.ceil(items.length / 2))].map((col, c) => <div key={c}>{col.map((x, i) => <div key={i}>{x}</div>)}</div>)}</div></> : null;
  const blocks: Record<SectionId, () => ReactNode> = {
    summary: () => (view.summary ? <>{h(style.summaryLabel, tags.summary)}<p className="mt-1 text-justify">{view.summary}</p></> : null),
    highlights: () => (view.highlights.length > 0 ? <>{h("Career Highlights", tags.highlights)}<ul className="ml-5 list-disc">{view.highlights.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null),
    extras: () => view.extras.map((x, k) => (
      <div key={k}>
        {h(x.title, tags.fixed)}
        {x.intro && <p className="mt-1 text-justify">{x.intro}</p>}
        {x.flow && <p className="mt-1 text-[#2E74B5]">{x.flow}</p>}
        <ul className="ml-5 list-disc">{x.bullets.map((b, i) => <li key={i}>{b.label && <b>{b.label}: </b>}{b.text}</li>)}</ul>
      </div>
    )),
    caseStudies: () => cols("Case Studies", view.caseStudies.map((c) => (c.url ? <>{c.title}: <a className="text-[#2E74B5] underline" href={c.url} target="_blank" rel="noreferrer">Click Here To View</a></> : c.title)), tags.fixed),
    competencies: () => grouped("Core Competencies", view.competencies, tags.skills),
    technical: () => grouped("Technical Skills", view.technical, tags.skills),
    development: () => cols("Professional Development", view.development, tags.fixed),
    awards: () => cols("Awards and Recognition", view.awards.map((a) => { const k = a.indexOf(","); return k < 0 ? a : <>{a.slice(0, k)}<span className="text-muted-foreground">{a.slice(k)}</span></>; }), tags.fixed),
    skills: () => (view.skills.length > 0 ? <>{h("Skills", tags.skills)}<p className="mt-1">{view.skills.join(", ")}</p></> : null),
    experience: () => (
      <>
        {h("Professional Experience", tags.fixed)}
        {view.experience.map((e, i) => (
          <div key={i} className={e.employer ? "mt-3" : "mt-1.5"}>
            {e.employer && <div className="flex justify-between gap-2 font-bold uppercase text-[#1F3A5F] dark:text-sky-300"><span>{[e.employer.name, e.employer.location].filter(Boolean).join(", ")}</span><span className="text-xs">{e.employer.dates}</span></div>}
            <div className="flex justify-between gap-2"><b>{e.title}</b>{e.dates && <span className="text-xs text-muted-foreground">{e.dates}</span>}</div>
            <ul className="ml-5 list-disc">{e.bullets.map((b, k) => <li key={k} className="text-justify">{b}</li>)}</ul>
            {tags.bullets && <div className="ml-5 mt-1">{tags.bullets} <span className="text-xs text-muted-foreground">the bullets for this role</span></div>}
          </div>
        ))}
      </>
    ),
    education: () => (view.education.length > 0 ? <>{h("Education", tags.fixed)}{view.education.map((e, i) => <div key={i} className="mt-1"><div className="flex justify-between gap-2"><b>{e.degree}</b><span className="text-xs text-muted-foreground">{e.dates}</span></div><div className="text-xs italic text-muted-foreground">{e.school}</div></div>)}</> : null),
    certifications: () => cols("Certifications", view.certifications, tags.fixed),
  };
  return (
    <article className="rounded-md border bg-card p-4 text-sm leading-relaxed" aria-label={label}>
      <div className="border-b-2 border-[#1F3A5F] pb-2">
        <div className="text-xl font-bold uppercase tracking-wide text-[#1F3A5F] dark:text-sky-300">{view.name}</div>
        {view.headline && <div className="mt-0.5 flex items-center gap-2 text-[#2E74B5]">{view.headline} {tags.headline}</div>}
        {view.credentials && <div className="mt-0.5 text-xs font-semibold">{view.credentials}</div>}
        <div className="mt-0.5 flex items-center gap-2 text-xs">{view.contact} {tags.contact}</div>
      </div>
      {view.metrics.length > 0 && <div className="mt-2 text-xs font-bold text-[#1F3A5F] dark:text-sky-300">{view.metrics.join("  |  ")}</div>}
      {style.sections.map((s) => <div key={s}>{blocks[s]()}</div>)}
    </article>
  );
}
