import { describe, expect, it, vi } from "vitest";
import { jsearchSearch, jsonFetcher, type FetchLike } from "@/lib/jobs/sources";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const gone = () => new Response(JSON.stringify({ message: "Endpoint '/search-v2' does not exist" }), { status: 404 });
const p = new URLSearchParams({ query: "pm in london" });

describe("jsearchSearch", () => {
  it("uses /search-v2 first and sends the key and host headers", async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(ok({ status: "OK", data: [{ job_id: "1" }] }));
    expect(await jsearchSearch(jsonFetcher(f), "KEY", p)).toEqual([{ job_id: "1" }]);
    const [url, init] = f.mock.calls[0];
    expect(url).toMatch(/^https:\/\/jsearch\.p\.rapidapi\.com\/search-v2\?query=pm\+in\+london/);
    expect(init?.headers).toMatchObject({ "X-RapidAPI-Key": "KEY", "X-RapidAPI-Host": "jsearch.p.rapidapi.com" });
  });
  it("falls back to /search when /search-v2 does not exist", async () => {
    const f = vi.fn<FetchLike>().mockResolvedValueOnce(gone()).mockResolvedValueOnce(ok({ data: [{ job_id: "2" }] }));
    expect(await jsearchSearch(jsonFetcher(f), "KEY", p)).toEqual([{ job_id: "2" }]);
    expect(f.mock.calls[1][0]).toMatch(/\/search\?/);
  });
  it("does not retry on a real refusal such as a quota error", async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(jsearchSearch(jsonFetcher(f), "KEY", p)).rejects.toThrow(/quota/);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("finds the job list wherever the response puts it", async () => {
    for (const body of [{ data: { jobs: [{ job_id: "a" }] } }, { data: { results: [{ job_id: "a" }] } }, { jobs: [{ job_id: "a" }] }]) {
      expect(await jsearchSearch(jsonFetcher(vi.fn<FetchLike>().mockResolvedValue(ok(body))), "K", p)).toEqual([{ job_id: "a" }]);
    }
    expect(await jsearchSearch(jsonFetcher(vi.fn<FetchLike>().mockResolvedValue(ok({ status: "OK" }))), "K", p)).toEqual([]);
  });
});
