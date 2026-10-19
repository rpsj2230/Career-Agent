import { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TabStopType, TextRun, WidthType } from "docx";
import type { CoverLetter, MasterProfile, TailoredResume } from "@/lib/types";
import { resumeView, type ResumeView } from "./sections";
import { STYLES, type ResumeStyle, type SectionId } from "./template";

const FONT = "Calibri";
const INK = "1F2937";
const MUTED = "6B7280";
const NAVY = "1F3A5F";
const BLUE = "2E74B5";
const RULE = "9CA3AF";
const MARGIN = 1000; // twips (about 0.7 in)
const PAGE = { A4: { width: 11906, height: 16838 }, Letter: { width: 12240, height: 15840 } } as const;
const textWidth = (page: ResumeStyle["page"]) => PAGE[page].width - 2 * MARGIN;

const run = (text: string, o: { bold?: boolean; italics?: boolean; size?: number; color?: string; spacing?: number; caps?: boolean } = {}) =>
  new TextRun({ text, font: FONT, size: o.size ?? 20, bold: o.bold, italics: o.italics, color: o.color ?? INK, characterSpacing: o.spacing, allCaps: o.caps });

/** A real heading (so parsers and screen readers find the section), in small spaced capitals with a thin rule under it. */
const heading = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    keepNext: true,
    spacing: { before: 170, after: 70 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 2 } },
    children: [run(text.toUpperCase(), { bold: true, size: 20, color: NAVY, spacing: 30 })],
  });
const body = (text: string) => new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 60, line: 264 }, children: [run(text)] });
const BULLET_INDENT = { left: 300, hanging: 200 } as const;
const bullet = (text: string, label = "") =>
  new Paragraph({ bullet: { level: 0 }, indent: BULLET_INDENT, alignment: AlignmentType.JUSTIFIED, spacing: { after: 30, line: 250 }, children: [...(label ? [run(`${label}: `, { bold: true })] : []), run(text)] });

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE } as const;

/** A short list in two columns (certifications, courses, awards, case studies): the first half down the left, the rest down the right. */
function twoColumns(items: Paragraph[][], width: number): Table {
  const half = Math.ceil(items.length / 2);
  const col = (xs: Paragraph[][]) => new TableCell({ width: { size: Math.floor(width / 2), type: WidthType.DXA }, borders: noBorders, margins: { top: 0, bottom: 0, left: 0, right: 120 }, children: xs.length ? xs.flat() : [new Paragraph({ children: [] })] });
  return new Table({ width: { size: width, type: WidthType.DXA }, columnWidths: [Math.floor(width / 2), width - Math.floor(width / 2)], borders: { ...noBorders, insideHorizontal: NONE, insideVertical: NONE }, rows: [new TableRow({ children: [col(items.slice(0, half)), col(items.slice(half))] })] });
}
const line = (...children: TextRun[] | ExternalHyperlink[] | (TextRun | ExternalHyperlink)[]) => new Paragraph({ spacing: { after: 30, line: 250 }, children: children as (TextRun | ExternalHyperlink)[] });

/** "Employee of the Year, Verz Design, 2019": the name in ink and the rest in grey, as on the master resume. */
function awardLine(text: string): Paragraph {
  const k = text.indexOf(",");
  return k < 0 ? line(run(text)) : line(run(text.slice(0, k)), run(text.slice(k), { color: MUTED }));
}

export function resumeParagraphs(p: MasterProfile, t: TailoredResume, style: ResumeStyle = STYLES[0]): (Paragraph | Table)[] {
  const v = resumeView(p, t, style);
  return buildResume(v, style);
}

export function buildResume(v: ResumeView, style: ResumeStyle = STYLES[0]): (Paragraph | Table)[] {
  const width = textWidth(style.page);
  const header: Paragraph[] = [
    new Paragraph({ spacing: { after: 20 }, children: [run(v.name, { bold: true, size: 44, color: NAVY, caps: true })] }),
    ...(v.headline ? [new Paragraph({ spacing: { after: 40 }, children: [run(v.headline, { size: 20, color: BLUE })] })] : []),
    ...(v.credentials ? [new Paragraph({ spacing: { after: 40 }, children: [run(v.credentials, { bold: true, size: 19 })] })] : []),
    new Paragraph({ spacing: { after: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY, space: 4 } }, children: [run(v.contact, { size: 19 })] }),
    ...(v.metrics.length ? [new Paragraph({ spacing: { before: 60, after: 60 }, children: [run(v.metrics.join("  |  "), { bold: true, size: 18, color: NAVY })] })] : []),
  ];
  const grouped = (label: string, gs: { group: string; items: string[] }[]) =>
    gs.length ? [heading(label), ...gs.map((g) => new Paragraph({ bullet: { level: 0 }, indent: BULLET_INDENT, alignment: AlignmentType.JUSTIFIED, spacing: { after: 30, line: 250 }, children: [...(g.group ? [run(`${g.group}: `, { bold: true })] : []), run(g.items.join(", "))] }))] : [];
  const blocks: Record<SectionId, () => (Paragraph | Table)[]> = {
    summary: () => (v.summary ? [heading(style.summaryLabel), body(v.summary)] : []),
    highlights: () => (v.highlights.length ? [heading("Career Highlights"), ...v.highlights.map((h) => bullet(h))] : []),
    extras: () => v.extras.flatMap((x) => [
      heading(x.title),
      ...(x.intro ? [body(x.intro)] : []),
      ...(x.flow ? [new Paragraph({ spacing: { after: 60 }, children: [run(x.flow, { color: BLUE })] })] : []),
      ...x.bullets.map((b) => bullet(b.text, b.label)),
    ]),
    caseStudies: () => (v.caseStudies.length ? [heading("Case Studies"), twoColumns(v.caseStudies.map((c) => [c.url ? line(run(`${c.title}: `), new ExternalHyperlink({ link: c.url, children: [run("Click Here To View", { color: BLUE })] })) : line(run(c.title))]), width)] : []),
    competencies: () => grouped("Core Competencies", v.competencies),
    technical: () => grouped("Technical Skills", v.technical),
    development: () => (v.development.length ? [heading("Professional Development"), twoColumns(v.development.map((d) => [line(run(d))]), width)] : []),
    awards: () => (v.awards.length ? [heading("Awards and Recognition"), twoColumns(v.awards.map((a) => [awardLine(a)]), width)] : []),
    skills: () => (v.skills.length ? [heading("Skills"), body(v.skills.join(", "))] : []),
    experience: () => {
      const out: (Paragraph | Table)[] = [heading("Professional Experience")];
      for (const e of v.experience) {
        if (e.employer) {
          out.push(new Paragraph({ keepNext: true, spacing: { before: 140, after: 30 }, tabStops: [{ type: TabStopType.RIGHT, position: width }], children: [run([e.employer.name, e.employer.location].filter(Boolean).join(", "), { bold: true, color: NAVY, caps: true }), ...(e.employer.dates ? [run(`\t${e.employer.dates}`, { bold: true, color: NAVY, size: 19 })] : [])] }));
        }
        out.push(
          new Paragraph({ keepNext: true, spacing: { before: e.employer ? 0 : 100, after: 30 }, tabStops: [{ type: TabStopType.RIGHT, position: width }], children: [run(e.title, { bold: true }), ...(e.dates ? [run(`\t${e.dates}`, { color: MUTED, size: 19 })] : [])] }),
          ...e.bullets.map((b) => bullet(b)),
        );
      }
      return out;
    },
    education: () => (v.education.length ? [heading("Education"), ...v.education.flatMap((e) => [
      new Paragraph({ keepNext: true, spacing: { before: 40, after: 0 }, tabStops: [{ type: TabStopType.RIGHT, position: width }], children: [run(e.degree, { bold: true }), ...(e.dates ? [run(`\t${e.dates}`, { color: MUTED, size: 19 })] : [])] }),
      new Paragraph({ spacing: { after: 40 }, children: [run(e.school, { italics: true, color: MUTED, size: 20 })] }),
    ])] : []),
    certifications: () => (v.certifications.length ? [heading("Certifications"), twoColumns(v.certifications.map((c) => [line(run(c))]), width)] : []),
  };
  return [...header, ...style.sections.flatMap((s) => blocks[s]())];
}

export async function renderResumeDocx(p: MasterProfile, t: TailoredResume, style: ResumeStyle = STYLES[0]): Promise<Buffer> {
  const { width, height } = PAGE[style.page];
  return Packer.toBuffer(new Document({
    creator: p.basics.name || "Resume",
    title: `${p.basics.name} - Resume`,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{ properties: { page: { size: { width, height }, margin: { top: 700, bottom: 700, left: MARGIN, right: MARGIN } } }, children: resumeParagraphs(p, t, style) }],
  }));
}

export async function renderCoverLetterDocx(p: MasterProfile, c: CoverLetter, company: string, style: ResumeStyle = STYLES[0]): Promise<Buffer> {
  const { width, height } = PAGE[style.page];
  const paras = c.text.split(/\n{2,}/).map((x) => new Paragraph({ spacing: { after: 160, line: 276 }, children: [run(x.trim(), { size: 22 })] }));
  return Packer.toBuffer(new Document({
    creator: p.basics.name || "Cover letter",
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ properties: { page: { size: { width, height }, margin: { top: 1200, bottom: 1200, left: 1300, right: 1300 } } }, children: [
      new Paragraph({ spacing: { after: 20 }, children: [run(p.basics.name, { bold: true, size: 28 })] }),
      new Paragraph({ spacing: { after: 280 }, children: [run([p.basics.email, p.basics.phone, p.basics.location].filter(Boolean).join("  |  "), { size: 20, color: MUTED })] }),
      new Paragraph({ spacing: { after: 240 }, children: [run(`Application to ${company}`, { bold: true, size: 22 })] }),
      ...paras,
      new Paragraph({ spacing: { before: 120 }, children: [run(p.basics.name, { size: 22 })] }),
    ] }],
  }));
}
