import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { buildFillData } from "../src/lib/apply/fill-data";
import { MasterProfile } from "../src/lib/types";

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

const profile = MasterProfile.parse({
  basics: { name: "Asha Rao", email: "asha@example.com", phone: "+65 8716 1454", location: "Singapore", links: ["https://www.linkedin.com/in/asha"] },
  experience: [{ id: "e1", company: "Verz", title: "Operations Director", start: "2012", end: "Present", bullets: [{ id: "b", text: "Moved delivery to Azure and ran training workshops" }] }],
  preferences: { countries: [], roles: [], noticePeriod: "60 days", languages: "English: fluent; Hindi: fluent" },
});
const data = buildFillData(profile, [{ question: "What is your notice period?", answer: "60 days" }, { question: "Are you comfortable with travel?", answer: "Yes" }], new Date("2026-10-23T00:00:00Z"));

describe("the data the extension is given", () => {
  it("holds who you are, your saved answers, languages and roles, and nothing secret", () => {
    expect(data.applicant).toMatchObject({ name: "Asha Rao", email: "asha@example.com", currentCompany: "Verz" });
    expect(data.answers).toHaveLength(2);
    expect(data.languages).toBe("English: fluent; Hindi: fluent");
    expect(data.experience[0].bullets[0]).toMatch(/Azure/);
    expect(JSON.stringify(data)).not.toMatch(/password|api[_-]?key|secret/i);
  });
});

describe("filling a page from the extension's script", () => {
  live("fills what it can answer, outlines the rest, never types a secret and never submits", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.setContent(`<form onsubmit="window.submitted = true; return false;">
      <label for="n">Full name*</label><input id="n" required>
      <label for="e">Email*</label><input id="e" type="email" required>
      <label for="p">Mobile phone*</label><input id="p" required>
      <label for="np">Notice period*</label><input id="np" required>
      <label for="az">How many years of work experience do you have with Azure?*</label><input id="az" required>
      <label for="mt">How many years of work experience do you have with Machine Tools?*</label><input id="mt" required>
      <label for="en">What is your level of proficiency in English?*</label><select id="en" required><option value="Select an option">Select an option</option><option>None</option><option>Fluent</option><option>Native</option></select>
      <label for="zh">What is your level of proficiency in Chinese?*</label><select id="zh" required><option value="Select an option">Select an option</option><option>None</option><option>Fluent</option></select>
      <fieldset><legend>Are you comfortable with travel?*</legend><label><input type="radio" name="t" value="y"> Yes</label><label><input type="radio" name="t" value="n"> No</label></fieldset>
      <label for="why">Describe your leadership style*</label><textarea id="why" required></textarea>
      <label for="pw">Password*</label><input id="pw" type="password" required>
      <label for="pre">Current company</label><input id="pre" value="Already typed">
      <label><input id="terms" type="checkbox" required> I agree to the Terms and Conditions</label>
      <button id="go" type="submit">Submit application</button></form>
      <script>window.submitted = false;</script>`);
    await page.addScriptTag({ content: bundle });
    const report = await page.evaluate((d) => (window as unknown as { __careerAgentFill: (x: unknown) => { filled: string[]; forYou: string[]; secret: string[] } }).__careerAgentFill(d), data);
    expect(await page.inputValue("#n")).toBe("Asha Rao");
    expect(await page.inputValue("#e")).toBe("asha@example.com");
    expect(await page.inputValue("#np")).toBe("60 days");
    expect(await page.inputValue("#az")).toBe("14"); // from the roles: 2012 to now
    expect(await page.inputValue("#mt")).toBe("12"); // the owner's default for a tool the profile does not show
    expect(await page.inputValue("#en")).toBe("Fluent");
    expect(await page.inputValue("#zh")).toBe("None");
    expect(await page.isChecked("input[value=y]")).toBe(true);
    expect(await page.inputValue("#pre")).toBe("Already typed"); // left alone
    expect(await page.isChecked("#terms")).toBe(true);
    expect(await page.inputValue("#pw")).toBe(""); // never typed
    expect(report.secret).toEqual(["Password"]);
    expect(report.forYou).toEqual(["Describe your leadership style"]); // outlined for you
    expect(await page.evaluate(() => (document.getElementById("why") as HTMLElement).style.outline)).toMatch(/orange|249/);
    expect(await page.evaluate(() => (window as unknown as { submitted: boolean }).submitted)).toBe(false); // nothing was submitted
    await page.close();
  });
  live("works inside a dialog and ignores the page's search box", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.setContent(`<header><input aria-label="Search jobs"></header><dialog open><label for="e">Email address*</label><input id="e" type="email" required></dialog>`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate((d) => (window as unknown as { __careerAgentFill: (x: unknown) => unknown }).__careerAgentFill(d), data);
    expect(await page.inputValue("#e")).toBe("asha@example.com");
    expect(await page.inputValue("header input")).toBe("");
    await page.close();
  });
});
