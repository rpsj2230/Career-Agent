import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import JSZip from "jszip";
import { linkedinExportToText } from "./linkedin";

const MAX_CHARS = 60_000;

export type Upload = { name: string; bytes: Uint8Array };

/** Extract plain text from a resume (PDF/DOCX/TXT/MD) or a LinkedIn export (.zip). */
export async function uploadToText(f: Upload): Promise<string> {
  const lower = f.name.toLowerCase();
  let text: string;
  if (lower.endsWith(".pdf")) {
    const pdf = await getDocumentProxy(f.bytes);
    text = (await extractText(pdf, { mergePages: true })).text;
  } else if (lower.endsWith(".docx")) {
    text = (await mammoth.extractRawText({ buffer: Buffer.from(f.bytes) })).value;
  } else if (lower.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(f.bytes);
    const files: Record<string, string> = {};
    for (const [name, entry] of Object.entries(zip.files)) {
      if (!entry.dir && name.toLowerCase().endsWith(".csv")) files[name] = await entry.async("string");
    }
    if (Object.keys(files).length === 0) throw new Error(`${f.name}: no CSV files found; expected a LinkedIn data export`);
    text = linkedinExportToText(files);
  } else if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    text = new TextDecoder().decode(f.bytes);
  } else {
    throw new Error(`${f.name}: unsupported file type (use PDF, DOCX, TXT, MD or a LinkedIn export .zip)`);
  }
  text = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error(`${f.name}: no text found (scanned image PDFs are not supported)`);
  return text.slice(0, MAX_CHARS);
}
