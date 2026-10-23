import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);
let browser: Browser | undefined;
let bundle = "";
beforeAll(async () => {
  const r = await build({ entryPoints: [join(process.cwd(), "extension/src/content.ts")], bundle: true, write: false, format: "iife", target: "chrome110", platform: "browser", alias: { "@": join(process.cwd(), "src") }, logLevel: "silent" });
  bundle = r.outputFiles[0].text;
  try { browser = await chromium.launch({ executablePath }); } catch { browser = undefined; }
});
afterAll(async () => { await browser?.close(); });
const live = it.skipIf(!process.env.CHROMIUM_PATH && !process.env.PLAYWRIGHT_BROWSERS_PATH);

const file = (name: string, text: string) => ({ name, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", b64: Buffer.from(text).toString("base64") });
type Attach = (r: unknown, c: unknown) => { attached: string[]; missing: string[] };

async function attach(page: Page, resume: unknown, cover: unknown = null) {
  await page.addScriptTag({ content: bundle });
  return page.evaluate(([r, c]) => (window as unknown as { __careerAgentAttach: Attach }).__careerAgentAttach(r, c), [resume, cover]);
}
/** What the page's own script saw: a framework listens for change and reads the files. */
const seen = (page: Page, id: string) => page.evaluate(async (i) => { const f = (document.getElementById(i) as HTMLInputElement).files; return f?.length ? { name: f[0].name, text: await f[0].text(), size: f[0].size } : null; }, id);

describe("attaching the application's resume in the page", () => {
  live("puts the resume in the box that asks for it and the cover letter in the box that asks for that, and tells the page", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.setContent(`<form>
      <label for="r">Resume/CV*</label><input type="file" id="r" style="display:none">
      <label for="c">Cover letter</label><input type="file" id="c">
      <button type="submit" id="go">Submit application</button></form>
      <script>window.events = []; document.querySelectorAll('input').forEach(i => i.addEventListener('change', () => window.events.push(i.id + ':' + i.files[0].name)));
      window.submitted = false; document.forms[0].onsubmit = () => { window.submitted = true; return false; };</script>`);
    const rep = await attach(page, file("Resume-Cygnify.docx", "RESUME BYTES"), file("Cover-Cygnify.docx", "COVER BYTES"));
    expect(rep).toEqual({ attached: ["Resume-Cygnify.docx", "Cover-Cygnify.docx"], missing: [] });
    expect(await seen(page, "r")).toEqual({ name: "Resume-Cygnify.docx", text: "RESUME BYTES", size: 12 });
    expect(await seen(page, "c")).toMatchObject({ name: "Cover-Cygnify.docx", text: "COVER BYTES" });
    expect(await page.evaluate(() => (window as unknown as { events: string[] }).events)).toEqual(["r:Resume-Cygnify.docx", "c:Cover-Cygnify.docx"]);
    expect(await page.evaluate(() => (window as unknown as { submitted: boolean }).submitted)).toBe(false);
    await page.close();
  });

  live("a page with one unlabelled file box gets the resume; one that says cover letter does not", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.setContent(`<div><span>Upload your documents</span><input type="file" id="only"></div>`);
    expect((await attach(page, file("r.docx", "x"))).attached).toEqual(["r.docx"]);
    const other = await browser.newPage();
    await other.setContent(`<label for="c">Cover letter</label><input type="file" id="c">`);
    const rep = await attach(other, file("r.docx", "x"));
    expect(rep.attached).toEqual([]);
    expect(rep.missing[0]).toMatch(/no file box on this page asks for a resume/);
    expect(await seen(other, "c")).toBeNull();
    await page.close(); await other.close();
  });

  live("leaves a box that already holds a file alone and says so when the page has no file box yet", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.setContent(`<label for="r">Resume</label><input type="file" id="r"><label for="r2">CV</label><input type="file" id="r2">`);
    await page.setInputFiles("#r", { name: "mine.pdf", mimeType: "application/pdf", buffer: Buffer.from("MINE") });
    const rep = await attach(page, file("tailored.docx", "T"));
    expect(rep.attached).toEqual(["tailored.docx"]);
    expect((await seen(page, "r"))!.name).toBe("mine.pdf");
    expect((await seen(page, "r2"))!.name).toBe("tailored.docx");
    const none = await browser.newPage();
    await none.setContent(`<button>Attach resume</button>`);
    expect((await attach(none, file("t.docx", "T"))).missing[0]).toMatch(/no file box yet/);
    await page.close(); await none.close();
  });
});
