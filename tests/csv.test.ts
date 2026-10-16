import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("quotes, escapes and neutralises formulas", () => {
    const out = toCsv([{ a: 'He said "hi", ok', b: "=HYPERLINK(\"x\")", c: null, d: 5 }], ["a", "b", "c", "d"]);
    expect(out).toBe('a,b,c,d\r\n"He said ""hi"", ok","\'=HYPERLINK(""x"")",,5\r\n');
  });
});
