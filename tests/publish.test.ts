import { expect, test } from "bun:test";
import { codex } from "../src/adapters/codex.ts";
import type { Fetcher } from "../src/fetch.ts";
import { publish } from "../src/publish.ts";
import { stable } from "../src/stable.ts";
import { initial } from "./helpers.ts";

const base = "a".repeat(40);
const head = "b".repeat(40);
const tree = "c".repeat(40);
const blob = "d".repeat(40);
const commit = "e".repeat(40);
const pull = {
  number: 7,
  html_url: "https://github.com/example/catalog/pull/7",
  head: { ref: "feat/catalog-sync" },
};
async function scenario(options: {
  equalBase?: boolean;
  existing?: boolean;
  equalHead?: boolean;
  head?: boolean;
  race?: boolean;
}) {
  const catalog = stable((await initial([codex])).registry);
  const calls: { route: string; method: string; body: Record<string, unknown> }[] = [];
  let baseReads = 0;
  const request: Fetcher = async (url, init) => {
    const route = url.replace("https://api.github.com/repos/example/catalog", "");
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ route, method, body });
    let result: unknown;
    if (route === "/git/ref/heads/main") {
      baseReads++;
      result = { object: { sha: options.race && baseReads > 1 ? head : base } };
    } else if (route.startsWith("/pulls?")) result = options.existing ? [pull] : [];
    else if (route.startsWith(`/contents/data/catalog.json?ref=${base}`))
      return new Response(options.equalBase ? catalog : "previous data");
    else if (route === "/git/ref/heads/feat%2Fcatalog-sync") {
      if (!options.head) return new Response("{}", { status: 404 });
      result = { object: { sha: head } };
    } else if (route.startsWith(`/contents/data/catalog.json?ref=${head}`))
      return new Response(options.equalHead ? catalog : "prior branch data");
    else if (route === `/git/commits/${base}`) result = { tree: { sha: tree } };
    else if (route === "/git/blobs") result = { sha: blob };
    else if (route === "/git/trees") result = { sha: tree };
    else if (route === "/git/commits") result = { sha: commit };
    else if (route.startsWith("/git/refs")) result = {};
    else if (route.startsWith("/pulls")) result = pull;
    else throw new Error(`Unexpected mock route: ${route}`);
    return Response.json(result);
  };
  return {
    calls,
    execute: () =>
      publish({
        repository: "example/catalog",
        baseBranch: "main",
        token: "test-token",
        catalog,
        report: "Test report",
        request,
      }),
  };
}
test("publication does not create a PR when data matches base", async () => {
  const run = await scenario({ equalBase: true });
  expect(await run.execute()).toBeNull();
  expect(run.calls.every((call) => call.method === "GET")).toBe(true);
});
test("first publication creates one scoped commit and one PR", async () => {
  const run = await scenario({});
  expect(await run.execute()).toBe(pull.html_url);
  expect(
    run.calls.filter((call) => call.route === "/pulls" && call.method === "POST"),
  ).toHaveLength(1);
  expect(
    run.calls.find((call) => call.route === "/git/commits" && call.method === "POST")?.body.parents,
  ).toEqual([base]);
  const generatedTree = run.calls.find((call) => call.route === "/git/trees");
  expect(generatedTree?.body.tree).toEqual([
    { path: "data/catalog.json", mode: "100644", type: "blob", sha: blob },
  ]);
});
test("subsequent publication appends history and updates the same PR", async () => {
  const run = await scenario({ existing: true, head: true });
  await run.execute();
  expect(
    run.calls.find((call) => call.route === "/git/commits" && call.method === "POST")?.body.parents,
  ).toEqual([head, base]);
  expect(run.calls.find((call) => call.route.startsWith("/git/refs/heads"))?.body.force).toBe(
    false,
  );
  expect(run.calls.some((call) => call.route === "/pulls/7" && call.method === "PATCH")).toBe(true);
  expect(run.calls.some((call) => call.route === "/pulls" && call.method === "POST")).toBe(false);
  expect(run.calls.some((call) => call.route.endsWith("/merge"))).toBe(false);
});
test("identical repeated runs do not create commits or duplicate PRs", async () => {
  const run = await scenario({ existing: true, head: true, equalHead: true });
  await run.execute();
  expect(run.calls.some((call) => call.method === "POST")).toBe(false);
});
test("publication refuses a changed default branch before updating refs", async () => {
  const run = await scenario({ race: true });
  await expect(run.execute()).rejects.toThrow("Default branch changed");
  expect(run.calls.some((call) => call.route.startsWith("/git/refs"))).toBe(false);
});
