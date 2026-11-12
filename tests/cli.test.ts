import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composedProviderSchema } from "../src/schema.ts";
import { hash } from "../src/stable.ts";

const root = process.env.CATALOG_TEST_ARTIFACT_DIR ?? ".artifacts/reports/cli-tests";
async function cli(args: string[], cwd = process.cwd()) {
  const child = Bun.spawn(
    [process.execPath, fileURLToPath(new URL("../src/cli.ts", import.meta.url)), ...args],
    {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}
test("offline CLI replay is idempotent and a failed upstream retains stale records", async () => {
  const directory = `${root}/${crypto.randomUUID()}`;
  await mkdir(directory, { recursive: true });
  const output = `${directory}/catalog.json`;
  const common = ["--fixtures", "tests/fixtures", "--output", output, "--report-dir", directory];
  expect((await cli(["sync", ...common])).code).toBe(0);
  const first = hash(await Bun.file(output).text());
  expect((await cli(["sync", ...common])).code).toBe(0);
  expect(hash(await Bun.file(output).text())).toBe(first);
  expect((await cli(["validate", "--output", output])).code).toBe(0);
  await Bun.write(`${directory}/invalid.json`, "{}");
  expect((await cli(["sync", ...common, "--upstream", `${directory}/invalid.json`])).code).toBe(1);
  const failed = await Bun.file(output).json();
  expect(
    failed.providers.every(
      (provider: { state: string; claims: unknown[] }) =>
        provider.state === "stale" && provider.claims.length > 0,
    ),
  ).toBe(true);
  const health = await Bun.file(`${directory}/health.json`).json();
  expect(health.state).toBe("failed");
  expect((await cli(["sync", ...common])).code).toBe(0);
  expect(hash(await Bun.file(output).text())).toBe(first);
});

test("provider routes preserve upstream metadata, filter plans, and rebuild deterministically", async () => {
  const directory = path.resolve(root, crypto.randomUUID());
  await mkdir(path.join(directory, "schemas"), { recursive: true });
  for (const name of ["catalog", "provider"]) {
    await Bun.write(
      path.join(directory, "schemas", `${name}.schema.json`),
      await Bun.file(`schemas/${name}.schema.json`).text(),
    );
  }
  const input = await Bun.file("tests/fixtures/upstream.json").text();
  await Bun.write(path.join(directory, "upstream.json"), input);
  const catalog = path.resolve("data/catalog.json");
  const args = [
    "build",
    "--upstream",
    path.join(directory, "upstream.json"),
    "--output",
    catalog,
    "--report-dir",
    path.join(directory, "reports"),
  ];
  const result = await cli(args, directory);
  expect(result.code).toBe(0);
  const providerFile = path.join(directory, "dist/providers/openai.json");
  const provider = composedProviderSchema.parse(await Bun.file(providerFile).json());
  expect(provider.id).toBe("openai");
  expect(Object.keys(provider.models).length).toBeGreaterThan(0);
  const product = composedProviderSchema.parse(
    await Bun.file(path.join(directory, "dist/providers/openai/products/openai-codex.json")).json(),
  );
  expect(product.subscription_catalog.selection).toEqual({
    status: "available",
    product: "openai-codex",
  });
  const plan = composedProviderSchema.parse(
    await Bun.file(
      path.join(directory, "dist/providers/openai/products/openai-codex/plans/plus.json"),
    ).json(),
  );
  expect(plan.subscription_catalog.selection).toEqual({
    status: "available",
    product: "openai-codex",
    plan: "plus",
  });
  expect(
    Object.values(plan.models).every((model) =>
      model.subscription_access.offers.every(
        (offer) => offer.product === "openai-codex" && offer.plan === "plus",
      ),
    ),
  ).toBe(true);
  const first = hash(await Bun.file(providerFile).text());
  expect((await cli(args, directory)).code).toBe(0);
  expect(hash(await Bun.file(providerFile).text())).toBe(first);
  await Bun.write(path.join(directory, "upstream.json"), "{}");
  expect((await cli(args, directory)).code).toBe(1);
  expect(hash(await Bun.file(providerFile).text())).toBe(first);
});
