import { beforeEach, describe, expect, it, vi } from "vitest";

let stored: Record<string, unknown>;
vi.mock("@/lib/profile/store", () => ({ getProfile: async () => ({ preferences: stored }), saveProfile: async (p: { preferences: Record<string, unknown> }) => { stored = p.preferences; } }));
vi.mock("@/lib/settings", () => ({ getSetting: async () => ({ roles: [] }), putSetting: async () => undefined }));
vi.mock("@/lib/activity-helpers", () => ({ logConfig: async () => undefined }));

import { PUT } from "@/app/api/profile/preferences/route";
const put = (body: unknown) => PUT(new Request("http://x/api/profile/preferences", { method: "PUT", body: JSON.stringify(body) }));

describe("saving preferences", () => {
  beforeEach(() => { stored = { countries: ["in"], roles: ["PM"], languages: "English: fluent", payCountry: "in" }; });
  it("the Languages card saves only the languages line", async () => {
    expect((await put({ languages: "English: fluent (read, write, speak); Hindi: fluent (read, write, speak)" })).status).toBe(200);
    expect(stored).toMatchObject({ countries: ["in"], roles: ["PM"], payCountry: "in", languages: "English: fluent (read, write, speak); Hindi: fluent (read, write, speak)" });
  });
  it("the Preferences form, which sends no languages line, does not wipe the saved one", async () => {
    expect((await put({ countries: ["sg"], roles: ["PM", "Programme Manager"] })).status).toBe(200);
    expect(stored).toMatchObject({ countries: ["sg"], languages: "English: fluent" });
  });
  it("rejects nonsense", async () => {
    expect((await put({ countries: "x" })).status).toBe(400);
  });
});
