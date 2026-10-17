import { describe, expect, it } from "vitest";
import { normalizeCredentialValues as n } from "@/lib/integrations/credential-input";

describe("credential input", () => {
  it("accepts a normal mailbox setup, including port 993 and a spaced app password", () => {
    expect(n({ imap_host: "imap.gmail.com", imap_user: "me@gmail.com", imap_password: "abcd efgh ijkl mnop", imap_port: "993", imap_folder: "INBOX" })).toEqual({
      ok: true, values: { imap_host: "imap.gmail.com", imap_user: "me@gmail.com", imap_password: "abcdefghijklmnop", imap_port: "993", imap_folder: "INBOX" },
    });
  });
  it("allows spaces in a folder name", () => expect(n({ imap_folder: "Job alerts" })).toEqual({ ok: true, values: { imap_folder: "Job alerts" } }));
  it("drops empty values", () => expect(n({ imap_host: "imap.gmail.com", imap_port: "  " })).toEqual({ ok: true, values: { imap_host: "imap.gmail.com" } }));
  it("rejects a bad port, short keys and spaces in keys", () => {
    expect(n({ imap_port: "99x" })).toMatchObject({ ok: false });
    expect(n({ imap_port: "70000" })).toMatchObject({ ok: false });
    expect(n({ api_key: "abc" })).toMatchObject({ ok: false, error: expect.stringMatching(/too short/) });
    expect(n({ api_key: "abcd efgh" })).toMatchObject({ ok: false, error: expect.stringMatching(/spaces/) });
    expect(n({})).toMatchObject({ ok: false });
  });
});
