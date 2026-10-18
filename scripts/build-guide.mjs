// Builds docs/Career-Agent-User-Guide.docx from docs/USER_GUIDE.md.   node scripts/build-guide.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { AlignmentType, BorderStyle, Document, Footer, HeadingLevel, LevelFormat, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";

const src = readFileSync(new URL("../docs/USER_GUIDE.md", import.meta.url), "utf8").split("\n");
const FONT = "Calibri", INK = "1F2937", MUTED = "4B5563", ACCENT = "1D4ED8";

/** **bold**, *italic*, `code` inside one line of text */
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, color: INK, ...base }));
    const t = m[0];
    if (t.startsWith("**")) out.push(new TextRun({ text: t.slice(2, -2), bold: true, font: FONT, color: INK, ...base }));
    else if (t.startsWith("`")) out.push(new TextRun({ text: t.slice(1, -1), font: "Consolas", color: "9A3412", size: (base.size ?? 22) - 2 }));
    else out.push(new TextRun({ text: t.slice(1, -1), italics: true, font: FONT, color: INK, ...base }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: FONT, color: INK, ...base }));
  return out;
}

const children = [];
const para = (text, o = {}) => new Paragraph({ spacing: { after: 100, line: 276 }, ...o, children: runs(text, o.run) });
const cell = (text, header, width) => new TableCell({
  width: { size: width, type: WidthType.DXA },
  shading: header ? { type: ShadingType.CLEAR, fill: "E5E7EB" } : undefined,
  margins: { top: 60, bottom: 60, left: 100, right: 100 },
  children: [new Paragraph({ spacing: { after: 0 }, children: runs(text, { size: 19, bold: header }) })],
});
const TOTAL = 9400;

let i = 0, n = 0;
while (i < src.length) {
  const line = src[i];
  if (!line.trim()) { i++; continue; }
  if (line.startsWith("```")) {
    const block = [];
    i++;
    while (i < src.length && !src[i].startsWith("```")) block.push(src[i++]);
    i++;
    for (const b of block) children.push(new Paragraph({ spacing: { after: 0 }, shading: { type: ShadingType.CLEAR, fill: "F3F4F6" }, children: [new TextRun({ text: b || " ", font: "Consolas", size: 16, color: INK })] }));
    children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    continue;
  }
  const h = /^(#{1,4})\s+(.*)$/.exec(line);
  if (h) {
    const lvl = h[1].length;
    if (lvl === 1) {
      children.push(new Paragraph({ spacing: { before: 1800, after: 200 }, alignment: AlignmentType.LEFT, children: [new TextRun({ text: h[2], bold: true, size: 56, font: FONT, color: ACCENT })] }));
    } else {
      children.push(new Paragraph({
        heading: [null, null, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][lvl],
        pageBreakBefore: false,
        spacing: { before: lvl === 2 ? 0 : 240, after: 120 }, keepNext: true,
        children: [new TextRun({ text: h[2], bold: true, font: FONT, color: lvl === 2 ? ACCENT : INK, size: lvl === 2 ? 34 : lvl === 3 ? 27 : 24 })],
      }));
    }
    i++; continue;
  }
  if (line.startsWith("|")) {
    const rows = [];
    while (i < src.length && src[i].startsWith("|")) { rows.push(src[i]); i++; }
    const cells = rows.filter((r) => !/^\|[\s:|-]+\|$/.test(r)).map((r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
    const cols = cells[0].length, w = Math.floor(TOTAL / cols);
    children.push(new Table({
      width: { size: TOTAL, type: WidthType.DXA }, columnWidths: Array(cols).fill(w),
      borders: Object.fromEntries(["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"].map((k) => [k, { style: BorderStyle.SINGLE, size: 4, color: "D1D5DB" }])),
      rows: cells.map((r, ri) => new TableRow({ tableHeader: ri === 0, cantSplit: true, children: r.map((c) => cell(c, ri === 0, w)) })),
    }));
    children.push(new Paragraph({ spacing: { after: 140 }, children: [] }));
    continue;
  }
  if (line.startsWith("> ")) {
    const q = [];
    while (i < src.length && src[i].startsWith("> ")) q.push(src[i++].slice(2));
    children.push(new Paragraph({ spacing: { before: 60, after: 140 }, indent: { left: 240 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 8 } }, children: runs(q.join(" "), { color: MUTED }) }));
    continue;
  }
  const b = /^(\s*)-\s+(.*)$/.exec(line), nm = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
  if (b || nm) {
    const indent = (b ?? nm)[1].length >= 2 ? 1 : 0;
    children.push(new Paragraph({ spacing: { after: 60, line: 264 }, ...(b ? { bullet: { level: indent } } : { numbering: { reference: "num", level: 0, instance: n } }), children: runs(b ? b[2] : nm[3]) }));
    i++; continue;
  }
  // italic subtitle line / normal paragraph
  children.push(para(line.trim()));
  i++;
}

const doc = new Document({
  creator: "Career Agent", title: "Career Agent: User Guide",
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  numbering: { config: [{ reference: "num", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1100, bottom: 1100, left: 1253, right: 1253 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Career Agent: User Guide · page ", size: 18, color: MUTED, font: FONT }), new TextRun({ children: [PageNumber.CURRENT], size: 18, color: MUTED, font: FONT })] })] }) },
    children,
  }],
});
writeFileSync(new URL("../docs/Career-Agent-User-Guide.docx", import.meta.url), await Packer.toBuffer(doc));
console.log("wrote docs/Career-Agent-User-Guide.docx");
