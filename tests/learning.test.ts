import { describe, expect, it } from "vitest";
import { buildStats, outcomeBias, type Outcome } from "@/lib/score/learning";

const o = (title: string, company: string, kind: Outcome["kind"]): Outcome => ({ title, company, kind });
const repeat = (n: number, x: Outcome) => Array.from({ length: n }, () => x);

describe("learning from outcomes", () => {
  it("does nothing until there are several examples", () => {
    const stats = buildStats([o("Product Manager", "Acme", "positive"), o("Product Manager", "Beta", "positive")]);
    expect(outcomeBias({ title: "Senior Product Manager", company: "Gamma" }, stats).bias).toBe(0);
  });
  it("raises jobs of a role type that led to interviews", () => {
    const stats = buildStats(repeat(6, o("Product Manager", "X", "positive")).map((x, i) => ({ ...x, company: `Co${i}` })));
    const b = outcomeBias({ title: "Senior Product Manager", company: "New" }, stats);
    expect(b.bias).toBeGreaterThan(3);
    expect(b.bias).toBeLessThanOrEqual(8);
    expect(b.why[0]).toMatch(/role type/);
  });
  it("lowers jobs of a role type you keep skipping or that keeps being rejected", () => {
    const stats = buildStats(repeat(8, o("Sales Manager", "X", "negative")).map((x, i) => ({ ...x, company: `Co${i}` })));
    expect(outcomeBias({ title: "Sales Manager", company: "New" }, stats).bias).toBeLessThan(-3);
  });
  it("a company counts too, and the total never passes 8 points either way", () => {
    const stats = buildStats([...repeat(12, o("Product Manager", "Acme Pte Ltd", "positive")), ...repeat(12, o("Product Manager", "Acme Pte Ltd", "positive"))]);
    const b = outcomeBias({ title: "Product Manager", company: "ACME" }, stats);
    expect(b.why.some((w) => /company/.test(w))).toBe(true);
    expect(b.bias).toBeLessThanOrEqual(8);
    const bad = buildStats(repeat(40, o("Product Manager", "Acme", "negative")));
    expect(outcomeBias({ title: "Product Manager", company: "Acme" }, bad).bias).toBeGreaterThanOrEqual(-8);
  });
  it("mixed results cancel out, and unrelated jobs are untouched", () => {
    const stats = buildStats([...repeat(3, o("Product Manager", "A", "positive")), ...repeat(3, o("Product Manager", "B", "negative"))]);
    expect(Math.abs(outcomeBias({ title: "Product Manager", company: "C" }, stats).bias)).toBeLessThanOrEqual(1);
    expect(outcomeBias({ title: "Data Engineer", company: "C" }, stats).bias).toBe(0);
  });
});
