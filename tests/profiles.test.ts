import { describe, expect, it, vi } from "vitest";
import { allowedProfiles, pickProfile, type ProfileRef } from "@/lib/profile-access";
import { labelled, recipients, subjectFor } from "@/lib/notify-rules";
import { cleanTeam } from "@/lib/roles";
import { browserDirFor, pickByName, slug } from "../worker/assist-profile";

vi.mock("server-only", () => ({}));

const P = (id: string, name: string, is_default = false, enabled = true): ProfileRef => ({ id, name, email: null, is_default, enabled });
const main = P("a", "Rupash", true), priya = P("b", "Priya"), sam = P("c", "Sam");
const all = [main, priya, sam];

describe("which profiles a person may open", () => {
  it("lets the super admin open any profile", () => expect(allowedProfiles(all, true, undefined)).toEqual(all));
  it("lets a team member open only the profiles named for them", () => expect(allowedProfiles(all, false, ["b"])).toEqual([priya]));
  it("gives a team member with none named the main profile only (what they could always see)", () => expect(allowedProfiles(all, false, undefined)).toEqual([main]));
  it("ignores names that no longer exist", () => expect(allowedProfiles(all, false, ["zzz"])).toEqual([]));
});

describe("which profile a request works on", () => {
  it("uses the one asked for when it is allowed", () => expect(pickProfile(all, "b")).toBe("b"));
  it("falls back to the main profile when the one asked for is not allowed or does not exist", () => {
    expect(pickProfile([main, sam], "b")).toBe("a");
    expect(pickProfile(all, "nope")).toBe("a");
    expect(pickProfile(all, undefined)).toBe("a");
  });
  it("falls back to the first allowed profile when the main one is not allowed", () => expect(pickProfile([priya, sam], "x")).toBe("b"));
  it("returns nothing when no profile is allowed", () => expect(pickProfile([], "a")).toBeNull());
});

describe("team entries keep the profiles named for them", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("keeps valid profile ids, drops junk and duplicates", () => {
    expect(cleanTeam([{ email: "A@x.com", role: "jobs", profiles: [id, id, "not-an-id", 5] }])).toEqual([{ email: "a@x.com", role: "jobs", profiles: [id] }]);
  });
  it("leaves the field out when none were named", () => expect(cleanTeam([{ email: "a@x.com", role: "viewer" }, { email: "b@x.com", role: "jobs", profiles: [] }])).toEqual([{ email: "a@x.com", role: "viewer" }, { email: "b@x.com", role: "jobs" }]));
});

describe("who is told", () => {
  it("sends to you and to the profile's own address once each, ignoring blanks and bad addresses", () => {
    expect(recipients("Me@x.com", "priya@x.com")).toEqual(["me@x.com", "priya@x.com"]);
    expect(recipients("me@x.com", "ME@x.com", ["me@x.com"])).toEqual(["me@x.com"]);
    expect(recipients(null, "", ["nope", " a@b.co "])).toEqual(["a@b.co"]);
    expect(recipients(undefined, undefined)).toEqual([]);
  });
  it("names the person only when there is more than one profile", () => {
    expect(labelled("Applied to Acme", "Priya", 1)).toBe("Applied to Acme");
    expect(labelled("Applied to Acme", "Priya", 2)).toBe("[Priya] Applied to Acme");
    expect(labelled("Applied to Acme", null, 3)).toBe("Applied to Acme");
  });
  it("builds a short subject", () => {
    expect(subjectFor("Career Agent: search finished.\nmore", undefined, "Priya", 2)).toBe("[Priya] Career Agent: search finished.");
    expect(subjectFor("body", "Daily report", null, 1)).toBe("Daily report");
    expect(subjectFor("x".repeat(500), undefined, "P", 2).length).toBe(120);
    expect(subjectFor("", undefined, null, 1)).toBe("Career Agent");
  });
});

describe("the apply assistant picks one person", () => {
  const who = [{ id: "a", name: "Rupash", is_default: true }, { id: "b", name: "Priya S.", is_default: false }];
  it("defaults to the main profile", () => expect(pickByName(who, undefined)).toEqual(who[0]));
  it("finds a profile by name (any capitals) or id", () => {
    expect(pickByName(who, "priya s.")).toEqual(who[1]);
    expect(pickByName(who, "b")).toEqual(who[1]);
  });
  it("says which names exist when the name is wrong", () => expect(pickByName(who, "Bob")).toEqual({ error: 'No profile is called "Bob". Profiles: Rupash, Priya S..' }));
  it("keeps the main profile's browser folder and gives everyone else their own", () => {
    expect(browserDirFor(who[0], {}, "/h")).toBe("/h/.career-agent/browser");
    expect(browserDirFor(null, {}, "/h")).toBe("/h/.career-agent/browser");
    expect(browserDirFor(who[1], {}, "/h")).toBe("/h/.career-agent/browser-priya-s");
    expect(browserDirFor(who[1], { ASSIST_PROFILE_DIR: "/x" }, "/h")).toBe("/x");
    expect(slug("  ../Évil/ name ")).toBe("vil-name");
  });
});

describe("profile input", () => {
  it("cleans the name and email and refuses bad ones", async () => {
    const { cleanProfileInput, ProfileError } = await import("@/lib/profiles-store");
    expect(cleanProfileInput({ name: "  Priya   S. ", email: " Priya@X.com " })).toEqual({ name: "Priya S.", email: "priya@x.com" });
    expect(cleanProfileInput({ name: "Sam", email: "" })).toEqual({ name: "Sam", email: null });
    expect(() => cleanProfileInput({ name: "  " })).toThrow(ProfileError);
    expect(() => cleanProfileInput({ name: "x".repeat(81) })).toThrow(ProfileError);
    expect(() => cleanProfileInput({ name: "Sam", email: "not-an-email" })).toThrow(/not an email/);
  });
});
