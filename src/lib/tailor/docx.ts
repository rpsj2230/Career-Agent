import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { CoverLetter, MasterProfile, TailoredResume } from "@/lib/types";
import { resumeView } from "./sections";

const heading = (text: string) =>
  new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 }, children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22 })] });
const body = (text: string) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text, size: 21 })] });
const bullet = (text: string) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text, size: 21 })] });

export function resumeParagraphs(p: MasterProfile, t: TailoredResume): Paragraph[] {
  const v = resumeView(p, t);
  const out: Paragraph[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: v.name, bold: true, size: 36 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: v.headline, size: 24 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: v.contact, size: 19 })] }),
    heading("Summary"), body(v.summary),
  ];
  if (v.skills.length) out.push(heading("Skills"), body(v.skills.join(", ")));
  out.push(heading("Experience"));
  for (const e of v.experience) {
    out.push(
      new Paragraph({ spacing: { before: 120 }, children: [
        new TextRun({ text: `${e.title}, ${e.company}`, bold: true, size: 22 }),
        new TextRun({ text: `   ${e.dates}${e.location ? `  |  ${e.location}` : ""}`, size: 20 }),
      ] }),
      ...e.bullets.map(bullet),
    );
  }
  if (v.education.length) out.push(heading("Education"), ...v.education.map(body));
  if (v.certifications.length) out.push(heading("Certifications"), ...v.certifications.map(bullet));
  return out;
}

export async function renderResumeDocx(p: MasterProfile, t: TailoredResume): Promise<Buffer> {
  return Packer.toBuffer(new Document({ sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } }, children: resumeParagraphs(p, t) }] }));
}

export async function renderCoverLetterDocx(p: MasterProfile, c: CoverLetter, company: string): Promise<Buffer> {
  const paras = c.text.split(/\n{2,}/).map((x) => new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: x.trim(), size: 22 })] }));
  return Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph({ children: [new TextRun({ text: p.basics.name, bold: true, size: 26 })] }),
    new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: [p.basics.email, p.basics.phone].filter(Boolean).join("  |  "), size: 20 })] }),
    new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: `Application to ${company}`, size: 22 })] }),
    ...paras,
    new Paragraph({ children: [new TextRun({ text: p.basics.name, size: 22 })] }),
  ] }] }));
}
