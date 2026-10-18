import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

describe("secrets", () => {
  it("round-trips and never stores the plaintext", () => {
    const enc = encryptSecret("gsk_abc123", "master-1");
    expect(enc).not.toContain("gsk_abc123");
    expect(enc.startsWith("v1.")).toBe(true);
    expect(decryptSecret(enc, "master-1")).toBe("gsk_abc123");
  });
  it("uses a fresh nonce each time", () => expect(encryptSecret("x", "m")).not.toBe(encryptSecret("x", "m")));
  it("refuses a different master secret, tampering and junk", () => {
    const enc = encryptSecret("secret", "master-1");
    expect(decryptSecret(enc, "master-2")).toBeNull();
    const i = enc.length - 8; // a character inside the data, never padding bits that could be ignored
    expect(decryptSecret(enc.slice(0, i) + (enc[i] === "A" ? "B" : "A") + enc.slice(i + 1), "master-1")).toBeNull();
    for (const junk of ["", "v1.a.b", "v2.a.b.c", "not-a-secret"]) expect(decryptSecret(junk, "master-1"), junk).toBeNull();
  });
});
