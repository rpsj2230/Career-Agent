import { describe, expect, it } from "vitest";
import { buildLibrary, matchesQuery, tagsFor } from "@/lib/tailor/library";
import { masterExt } from "@/lib/tailor/master-store-pure";

const doc = (id: string, job: string, created: string, v: Record<string, unknown> | null, title = "Senior Product Manager", country = "sg") =>
  ({ id, job_id: job, version: 1, storage_path: `${job}/resume-v1.docx`, created_at: created, verification: v as never, job: { title, company: "Acme", country } });

describe("resume library", () => {
  const docs = [
    doc("d1", "j1", "2026-01-01T00:00:00Z", { ok: true, style: "standard", reuse: { mode: "fresh" } }),
    doc("d2", "j2", "2026-01-05T00:00:00Z", { ok: true, style: "standard", reuse: { mode: "reused", from: { jobId: "j1", title: "Senior Product Manager" } } }, "Product Manager"),
    doc("d3", "j3", "2026-01-06T00:00:00Z", { ok: true, fallback: "master_original" }, "Analyst", "in"),
    doc("d4", "j1", "2025-12-01T00:00:00Z", { ok: false }), // older version of the same job: ignored
    doc("d5", "j4", "2026-01-07T00:00:00Z", { ok: false, style: "us" }, "Designer", "us"),
  ];
  const rows = buildLibrary(docs, new Map([["j1", "interview"]]));
  it("keeps the newest resume per job, newest first", () => {
    expect(rows.map((r) => r.documentId)).toEqual(["d5", "d3", "d2", "d1"]);
  });
  it("tells how each was made and counts reuse", () => {
    const by = Object.fromEntries(rows.map((r) => [r.documentId, r]));
    expect(by.d1).toMatchObject({ mode: "fresh", usedAgain: 1, lifecycle: "interview", verified: true });
    expect(by.d2).toMatchObject({ mode: "reused", sourceTitle: "Senior Product Manager" });
    expect(by.d3.mode).toBe("master");
    expect(by.d5.verified).toBe(false);
  });
  it("tags by role, country, style, how it was made and outcome", () => {
    const t = tagsFor(rows.find((r) => r.documentId === "d1")!);
    expect(t).toEqual(expect.arrayContaining(["product", "SG", "standard style", "written for this job", "interview", "reused 1×"]));
    expect(t).not.toContain("senior"); // seniority words are not role tags
    expect(tagsFor(rows.find((r) => r.documentId === "d5")!)).toContain("needs review");
    expect(tagsFor(rows.find((r) => r.documentId === "d3")!)).toContain("master resume");
  });
  it("searches by any combination of role, company, country or tag", () => {
    const d1 = rows.find((r) => r.documentId === "d1")!;
    expect(matchesQuery(d1, "product sg")).toBe(true);
    expect(matchesQuery(d1, "acme interview")).toBe(true);
    expect(matchesQuery(d1, "designer")).toBe(false);
    expect(matchesQuery(d1, "")).toBe(true);
  });
});

describe("master resume file types", () => {
  it("accepts PDF and DOCX only", () => {
    expect(masterExt("CV.PDF")).toBe("pdf");
    expect(masterExt("my resume.docx")).toBe("docx");
    expect(masterExt("linkedin-export.zip")).toBeNull();
    expect(masterExt("resume.doc")).toBeNull();
  });
});
