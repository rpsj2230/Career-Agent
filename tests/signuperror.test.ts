import { describe, expect, it } from "vitest";
import { explainSignupError } from "@/lib/signup";

describe("explainSignupError", () => {
  it("says what to do for each cause", () => {
    expect(explainSignupError("User already registered")).toMatchObject({ status: 409 });
    expect(explainSignupError("Password should be at least 6 characters")).toMatchObject({ status: 400 });
    expect(explainSignupError("Password is known to be weak and easy to guess")).toMatchObject({ status: 400 });
    expect(explainSignupError("Invalid API key").text).toMatch(/service_role key/);
    expect(explainSignupError("x", 401).text).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(explainSignupError("fetch failed").text).toMatch(/SUPABASE_URL/);
    expect(explainSignupError("something odd").text).toMatch(/Could not create the account: something odd/);
  });
});
