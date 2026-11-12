import { expect, test } from "bun:test";
import { fetchText, githubLoader } from "../src/fetch.ts";
import { hash } from "../src/stable.ts";

test("HTTP failures, empty bodies, invalid encoding, and oversized inputs are rejected", async () => {
  await expect(
    fetchText("https://example.org", async () => new Response("error", { status: 503 })),
  ).rejects.toThrow("HTTP 503");
  await expect(fetchText("https://example.org", async () => new Response("  "))).rejects.toThrow(
    "Empty source",
  );
  await expect(
    fetchText("https://example.org", async () => new Response("abcd"), 3),
  ).rejects.toThrow("size limit");
  await expect(
    fetchText("https://example.org", async () => new Response(new Uint8Array([255]))),
  ).rejects.toThrow();
});
test("network and body-read failures remain visible", async () => {
  await expect(
    fetchText("https://example.org", async () => {
      throw new Error("network");
    }),
  ).rejects.toThrow("Source request failed");
  await expect(
    fetchText(
      "https://example.org",
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("body"));
            },
          }),
        ),
    ),
  ).rejects.toThrow("Source body failed");
});
test("request policy forbids redirects and uses a bounded abort signal", async () => {
  const body = await fetchText("https://example.org", async (_url, init) => {
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return new Response("source");
  });
  expect(body).toBe("source");
});
test("GitHub retrieval pins the path commit and records the exact bytes", async () => {
  const revision = "a".repeat(40);
  const urls: string[] = [];
  const loader = githubLoader(async (url) => {
    urls.push(url);
    return url.startsWith("https://api.github.com/")
      ? Response.json([{ sha: revision, commit: { committer: { date: "2026-11-12T00:00:00Z" } } }])
      : new Response("source bytes\n");
  });
  const result = await loader("official/repo", "data/models.json", "source");
  expect(urls[0]).toContain("path=data%2Fmodels.json&per_page=1");
  expect(urls[1]).toBe(
    `https://raw.githubusercontent.com/official/repo/${revision}/data/models.json`,
  );
  expect(result.source.sha256).toBe(hash("source bytes\n"));
  expect(result.source.revision).toBe(revision);
});
