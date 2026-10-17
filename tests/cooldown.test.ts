import { describe, expect, it, vi } from "vitest";

const rows: Record<string, unknown>[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: () => ({ from: () => { const c: Record<string, unknown> = { select: () => c, in: () => c, gte: () => c, limit: () => c, then: (f: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(f) }; return c; } }) }));
import { recentCompanyApplication } from "@/lib/apply/cooldown";

const app = (id: string, company: string, title = "Analyst") => ({ id, approved_at: "2026-10-15T00:00:00Z", status: "submitted", job: { title, company } });

describe("company cool-down", () => {
  it("finds a recent application to the same company, in any spelling", async () => {
    rows.length = 0; rows.push(app("a", "ACME Pte. Ltd."), app("b", "Globex"));
    expect(await recentCompanyApplication("Acme", 14, "x")).toMatchObject({ title: "Analyst" });
  });
  it("ignores the application being approved, other companies, and a switched-off cool-down", async () => {
    rows.length = 0; rows.push(app("a", "Acme"));
    expect(await recentCompanyApplication("Acme", 14, "a")).toBeNull();
    expect(await recentCompanyApplication("Globex", 14, "x")).toBeNull();
    expect(await recentCompanyApplication("Acme", 0, "x")).toBeNull();
    expect(await recentCompanyApplication("", 14, "x")).toBeNull();
  });
});
