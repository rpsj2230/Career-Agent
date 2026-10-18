import { describe, expect, it } from "vitest";
import { chooseBrowser } from "../worker/browser";

const mac = (exists: (p: string) => boolean, env: Record<string, string> = {}, conf?: string) => chooseBrowser({ env, platform: "darwin", exists, conf });
const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";

describe("chooseBrowser", () => {
  it("uses the assistant's own Chromium by default", () => expect(mac(() => false)).toEqual({ name: "the assistant's own Chromium" }));
  it("finds Brave from the environment or the config file", () => {
    expect(mac((p) => p === BRAVE, { ASSIST_BROWSER: "brave" }).executablePath).toBe(BRAVE);
    expect(mac((p) => p === BRAVE, {}, "Brave\n").executablePath).toBe(BRAVE);
  });
  it("says so when Brave is chosen but not installed", () => expect(() => mac(() => false, { ASSIST_BROWSER: "brave" })).toThrow(/Brave was chosen/));
  it("supports chrome, edge, a path, and rejects nonsense", () => {
    expect(mac(() => false, { ASSIST_BROWSER: "chrome" }).channel).toBe("chrome");
    expect(mac(() => false, { ASSIST_BROWSER: "edge" }).channel).toBe("msedge");
    expect(mac((p) => p === "/x/browser", { ASSIST_BROWSER: "/x/browser" }).executablePath).toBe("/x/browser");
    expect(() => mac(() => false, { ASSIST_BROWSER: "netscape" })).toThrow(/not recognised/);
  });
  it("lets the explicit path variable win", () => expect(mac(() => true, { CHROMIUM_PATH: "/p", ASSIST_BROWSER: "brave" }).executablePath).toBe("/p"));
});
