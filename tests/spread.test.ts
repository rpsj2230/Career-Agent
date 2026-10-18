import { describe, expect, it } from "vitest";
import { ModelParking, parkMillis, spreadOrder } from "@/lib/llm/spread";

const m = (label: string, tier: "fast" | "strong") => ({ label, tier });
const models = [m("a", "strong"), m("b", "strong"), m("c", "strong"), m("d", "fast")];
const run = (tick: number, parked: string[] = []) => spreadOrder(models, { tierOf: (x) => x.tier, tick, parked: (l) => parked.includes(l) }).map((x) => x.label);

describe("spreadOrder", () => {
  it("rotates the start among the preferred tier and keeps every model", () => {
    expect(run(0)).toEqual(["a", "b", "c", "d"]);
    expect(run(1)).toEqual(["b", "c", "a", "d"]);
    expect(run(2)).toEqual(["c", "a", "b", "d"]);
    expect(run(3)).toEqual(["a", "b", "c", "d"]);
  });
  it("puts a parked model last and never loses it", () => {
    expect(run(0, ["a"])).toEqual(["b", "c", "d", "a"]);
    expect(run(1, ["a"])).toEqual(["c", "b", "d", "a"]);
  });
  it("does not rotate when everything is parked", () => expect(run(1, ["a", "b", "c", "d"])).toEqual(["a", "b", "c", "d"]));
});

describe("parking", () => {
  it("parks longer for refused keys and used-up quotas, then forgets", () => {
    expect(parkMillis("401 Unauthorized")).toBeGreaterThan(parkMillis("429 rate limit"));
    expect(parkMillis("429 rate limit")).toBeGreaterThan(parkMillis("bad json"));
    let t = 0;
    const p = new ModelParking(() => t);
    p.park("a", "429 rate limit");
    expect(p.isParked("a")).toBe(true);
    t = 6 * 60_000;
    expect(p.isParked("a")).toBe(false);
    p.park("a", "x"); p.clear("a");
    expect(p.isParked("a")).toBe(false);
  });
});
