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
  const result = await loader({
    kind: "github",
    repo: "official/repo",
    path: "data/models.json",
    id: "source",
  });
  expect(urls[0]).toContain("path=data%2Fmodels.json&per_page=1");
  expect(urls[1]).toBe(
    `https://raw.githubusercontent.com/official/repo/${revision}/data/models.json`,
  );
  expect(result.source.sha256).toBe(hash("source bytes\n"));
  expect(result.source.revision).toBe(revision);
});

test("GitHub metadata uses the supplied token without authenticating raw sources", async () => {
  const revision = "a".repeat(40);
  let metadataRequests = 0;
  let rawRequests = 0;
  const loader = githubLoader(async (url, init) => {
    const headers = new Headers(init?.headers);
    if (url.startsWith("https://api.github.com/")) {
      metadataRequests++;
      if (headers.get("Authorization") !== "Bearer test-github-token") {
        return new Response("Anonymous source metadata access rejected", { status: 403 });
      }
      expect(init?.redirect).toBe("error");
      return Response.json([
        { sha: revision, commit: { committer: { date: "2026-11-12T00:00:00Z" } } },
      ]);
    }
    rawRequests++;
    expect(headers.has("Authorization")).toBe(false);
    return new Response("public source bytes");
  }, "test-github-token");
  const result = await loader({
    kind: "github",
    repo: "official/repo",
    path: "data/models.json",
    id: "source",
  });
  expect(result.body).toBe("public source bytes");
  expect(metadataRequests).toBe(1);
  expect(rawRequests).toBe(1);
});

test("public catalogs reuse exact anonymous source bytes without fabricating source dates", async () => {
  const { publicLoader } = await import("../src/fetch.ts");
  let calls = 0;
  const loader = publicLoader(async (_url, init) => {
    calls++;
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    return new Response("public bytes");
  }, "github-token-must-not-reach-provider");
  const [first, second] = await Promise.all(
    ["one", "two"].map((id) =>
      loader({ kind: "http", url: "https://example.org/public/models", id }),
    ),
  );
  expect(calls).toBe(1);
  expect(first?.source.id).toBe("one");
  expect(second?.source.id).toBe("two");
  expect(first?.source.revision).toBeNull();
  expect(first?.source.modified_at).toBeNull();
  expect(first?.source.sha256).toBe(hash("public bytes"));
  await expect(
    loader({ kind: "http", id: "bad", url: "https://user:password@example.org/" }),
  ).rejects.toThrow("HTTPS");
});
