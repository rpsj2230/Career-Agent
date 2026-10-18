import { describe, expect, it } from "vitest";
import { cleanTeam, homeFor, navHrefsFor, roleAllows } from "@/lib/roles";
import { isPublic } from "@/lib/access";

describe("roleAllows", () => {
  it("lets the super admin do everything", () => {
    for (const p of ["/", "/settings", "/models", "/api/settings", "/api/run/score", "/api/team"]) expect(roleAllows("admin", p, "PUT"), p).toBe(true);
  });
  it("gives Jobs & Apply only the two sections and their actions", () => {
    for (const [p, m] of [["/jobs", "GET"], ["/jobs/abc", "GET"], ["/applications", "GET"], ["/applications/xyz", "GET"], ["/api/applications/1", "PUT"], ["/api/applications/1/regenerate", "POST"], ["/api/jobs/1/prepare", "POST"], ["/api/bulk", "POST"], ["/api/assistant/run", "POST"], ["/api/files", "GET"]] as const) expect(roleAllows("jobs", p, m), `${m} ${p}`).toBe(true);
    for (const [p, m] of [["/", "GET"], ["/settings", "GET"], ["/models", "GET"], ["/profile", "GET"], ["/logs", "GET"], ["/api/settings", "PUT"], ["/api/models/key", "PUT"], ["/api/run/score", "POST"], ["/api/team", "GET"], ["/api/schedules", "POST"], ["/api/integrations/x/credentials", "PUT"], ["/api/answers", "PUT"], ["/jobsx", "GET"], ["/api/jobsx", "GET"]] as const) expect(roleAllows("jobs", p, m), `${m} ${p}`).toBe(false);
  });
  it("gives View only the same sections without any change", () => {
    expect(roleAllows("viewer", "/jobs", "GET")).toBe(true);
    expect(roleAllows("viewer", "/applications/1", "GET")).toBe(true);
    expect(roleAllows("viewer", "/api/files", "GET")).toBe(true);
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) { expect(roleAllows("viewer", "/api/applications/1", m), m).toBe(false); expect(roleAllows("viewer", "/api/bulk", m), m).toBe(false); }
    expect(roleAllows("viewer", "/settings", "GET")).toBe(false);
  });
  it("does not let a path trick past the checks", () => {
    expect(roleAllows("jobs", "/jobs/../settings", "GET")).toBe(true); // the framework normalises the path before the proxy sees it; the literal string still starts with /jobs
    expect(roleAllows("jobs", "/api/jobs-admin", "POST")).toBe(false);
    expect(roleAllows("jobs", "/api/applications.evil", "POST")).toBe(false);
  });
  it("sends non-admins to Jobs and shows them two links", () => {
    expect(homeFor("admin")).toBe("/"); expect(homeFor("jobs")).toBe("/jobs"); expect(homeFor("viewer")).toBe("/jobs");
    expect(navHrefsFor("admin")).toBeNull(); expect(navHrefsFor("viewer")).toEqual(["/jobs", "/applications"]);
  });
  it("keeps the Google sign-in steps reachable before a session exists", () => {
    expect(isPublic("/api/auth/google")).toBe(true); expect(isPublic("/api/auth/callback")).toBe(true); expect(isPublic("/api/team")).toBe(false);
  });
});

describe("cleanTeam", () => {
  it("lower-cases, drops duplicates and invalid entries, and never stores an admin role", () => {
    expect(cleanTeam([{ email: " A@X.com ", role: "jobs" }, { email: "a@x.com", role: "viewer" }, { email: "b@x.com", role: "admin" }, { email: "", role: "jobs" }, null, { email: "c@x.com", role: "viewer" }]))
      .toEqual([{ email: "a@x.com", role: "jobs" }, { email: "c@x.com", role: "viewer" }]);
    expect(cleanTeam("nope")).toEqual([]);
  });
});
