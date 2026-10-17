import { AlignmentType, BorderStyle, Document, Packer, Paragraph, TabStopType, TextRun } from "docx";
import type { CoverLetter, MasterProfile, TailoredResume } from "@/lib/types";
import { resumeView } from "./sections";
import { STYLES, type ResumeStyle, type SectionId } from "./template";

const FONT = "Calibri";
const INK = "1F2937";
const MUTED = "4B5563";
const MARGIN = 1000; // twips (about 0.7 in)
const PAGE = { A4: { width: 11906, height: 16838 }, Letter: { width: 12240, height: 15840 } } as const;
const textWidth = (page: ResumeStyle["page"]) => PAGE[page].width - 2 * MARGIN;

const run = (text: string, o: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) =>
  new TextRun({ text, font: FONT, size: o.size ?? 21, bold: o.bold, italics: o.italics, color: o.color ?? INK });

const heading = (text: string) =>
  new Paragraph({
    keepNext: true,
    spacing: { before: 200, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "9CA3AF", space: 2 } },
    children: [run(text.toUpperCase(), { bold: true, size: 21, color: INK })],
  });
const body = (text: string) => new Paragraph({ spacing: { after: 60, line: 264 }, children: [run(text)] });
const bullet = (text: string) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 30, line: 259 }, children: [run(text)] });

export function resumeParagraphs(p: MasterProfile, t: TailoredResume, style: ResumeStyle = STYLES[0]): Paragraph[] {
  const v = resumeView(p, t, style);
  const width = textWidth(style.page);
  const header: Paragraph[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 }, children: [run(v.name, { bold: true, size: 40 })] }),
    ...(v.headline ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [run(v.headline, { size: 24, color: MUTED })] })] : []),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [run(v.contact, { size: 19, color: MUTED })] }),
  ];
  const blocks: Record<SectionId, () => Paragraph[]> = {
    summary: () => (v.summary ? [heading(style.summaryLabel), body(v.summary)] : []),
    skills: () => (v.skills.length ? [heading("Skills"), body(v.skills.join("  •  "))] : []),
    experience: () => {
      const out: Paragraph[] = [heading("Experience")];
      for (const e of v.experience) {
        out.push(
          new Paragraph({ keepNext: true, spacing: { before: 110, after: 10 }, tabStops: [{ type: TabStopType.RIGHT, position: width }], children: [run(e.title, { bold: true }), run(`  ·  ${e.company}`, { bold: true }), run(`\t${e.dates}`, { color: MUTED })] }),
          ...(e.location ? [new Paragraph({ keepNext: true, spacing: { after: 30 }, children: [run(e.location, { italics: true, size: 19, color: MUTED })] })] : []),
          ...e.bullets.map(bullet),
        );
      }
      return out;
    },
    education: () => (v.education.length ? [heading("Education"), ...v.education.map(body)] : []),
    certifications: () => (v.certifications.length ? [heading("Certifications"), ...v.certifications.map(bullet)] : []),
  };
  return [...header, ...style.sections.flatMap((s) => blocks[s]())];
}

export async function renderResumeDocx(p: MasterProfile, t: TailoredResume, style: ResumeStyle = STYLES[0]): Promise<Buffer> {
  const { width, height } = PAGE[style.page];
  return Packer.toBuffer(new Document({
    creator: p.basics.name || "Resume",
    title: `${p.basics.name} - Resume`,
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [{ properties: { page: { size: { width, height }, margin: { top: 800, bottom: 800, left: MARGIN, right: MARGIN } } }, children: resumeParagraphs(p, t, style) }],
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
