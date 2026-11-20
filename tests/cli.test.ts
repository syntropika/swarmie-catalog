import { expect, test } from "bun:test";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectionSchema, connectionsSchema } from "../src/connections.ts";
import { subscriptionManifestSchema } from "../src/integration-schema.ts";
import { composedProviderSchema, composedSubscriptionSchema } from "../src/schema.ts";
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

test("provider routes embed plan vectors without product or plan files and rebuild deterministically", async () => {
  const directory = path.resolve(root, crypto.randomUUID());
  await mkdir(path.join(directory, "schemas"), { recursive: true });
  for (const name of [
    "catalog",
    "provider",
    "subscription",
    "subscriptions",
    "provider-research",
    "provider-access",
    "connections",
    "connection",
    "connection-discovery",
    "model-sources",
    "model-research",
  ]) {
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
  expect(provider.subscription_catalog.schema_version).toBe(4);
  expect(
    Object.values(provider.models).some((model) =>
      model.subscription_access.some(
        (offer) => offer.product === "openai-codex" && offer.plans.includes("plus"),
      ),
    ),
  ).toBe(true);
  const files = await readdir(path.join(directory, "dist/providers"), { withFileTypes: true });
  expect(files.every((file) => file.isFile() && file.name.endsWith(".json"))).toBe(true);
  const index = await Bun.file(path.join(directory, "dist/index.json")).json();
  expect(index.providers).toContainEqual({ id: "openai", path: "providers/openai.json" });
  for (const id of ["chatgpt", "github-copilot"]) {
    const file = path.join(directory, `dist/subscriptions/${id}.json`);
    const subscription = composedSubscriptionSchema.parse(await Bun.file(file).json());
    expect(subscription.id).toBe(id);
    expect(Object.values(subscription.models).length).toBeGreaterThan(0);
    expect(
      Object.values(subscription.models).every((model) =>
        model.subscription_access.every((entry) => entry.subscription === id),
      ),
    ).toBe(true);
    expect(index.subscriptions).toContainEqual({
      id,
      name: subscription.name,
      products: subscription.products,
      model_catalog: subscription.model_catalog,
      path: `subscriptions/${id}.json`,
    });
  }
  const manifest = subscriptionManifestSchema.parse(
    await Bun.file(path.join(directory, "dist/subscriptions.json")).json(),
  );
  expect(manifest.subscriptions.length).toBeGreaterThan(2);
  const modelCoverage = await Bun.file(
    path.join(directory, "dist/subscription-coverage.json"),
  ).json();
  expect(modelCoverage.available.length + modelCoverage.unavailable.length).toBe(
    manifest.subscriptions.length,
  );
  for (const definition of manifest.subscriptions) {
    const file = Bun.file(path.join(directory, `dist/subscriptions/${definition.id}.json`));
    if (index.subscriptions.some((item: { id: string }) => item.id === definition.id)) {
      const subscription = composedSubscriptionSchema.parse(await file.json());
      expect(Object.keys(subscription.models).length).toBeGreaterThan(0);
      expect(subscription.integration).toEqual(definition.integration);
    } else {
      expect(await file.exists()).toBe(false);
      expect(
        modelCoverage.unavailable.some(
          (item: { id: string; reason: string }) =>
            item.id === definition.id && item.reason === "no-qualified-public-model-source",
        ),
      ).toBe(true);
    }
  }
  const connections = connectionsSchema.parse(
    await Bun.file(path.join(directory, "dist/connections.json")).json(),
  );
  expect(
    connections.connections.some((connection) => connection.execution === "coding-agent"),
  ).toBe(true);
  expect(index.model_selection).toBe("connection-discovery-required");
  for (const connection of connections.connections) {
    expect(
      connectionSchema.parse(await Bun.file(path.join(directory, "dist", connection.path)).json()),
    ).toEqual(connection);
  }
  for (const group of index.connection_groups) {
    const view = connectionsSchema.parse(
      await Bun.file(path.join(directory, "dist", group.path)).json(),
    );
    expect(
      view.connections.every((connection) =>
        group.id === "coding-agents"
          ? connection.execution === "coding-agent"
          : connection.execution === "direct-model" &&
            (group.id === "direct-subscriptions"
              ? connection.billing.kind === "subscription"
              : connection.billing.subscription_id === null),
      ),
    ).toBe(true);
  }
  const openaiConnections = connectionsSchema.parse(
    await Bun.file(path.join(directory, "dist/connections/providers/openai.json")).json(),
  );
  expect(openaiConnections.connections).toHaveLength(5);
  expect(
    openaiConnections.connections.every((connection) => connection.service_id !== "github-copilot"),
  ).toBe(true);
  const research = await Bun.file(path.join(directory, "dist/provider-research.json")).json();
  expect(research.counts.total).toBe(Object.keys(JSON.parse(input).providers).length);
  expect(provider.subscription_research.provider_id).toBe(provider.id);
  const accessReview = await Bun.file(path.join(directory, "dist/provider-access.json")).json();
  expect(accessReview.role).toBe("research-only");
  expect(accessReview.counts.total).toBe(Object.keys(JSON.parse(input).providers).length);
  expect(
    accessReview.providers.some(
      (review: { provider_id: string }) => review.provider_id === "openai",
    ),
  ).toBe(true);
  const first = hash(await Bun.file(providerFile).text());
  expect((await cli(args, directory)).code).toBe(0);
  expect(hash(await Bun.file(providerFile).text())).toBe(first);
  await Bun.write(path.join(directory, "upstream.json"), "{}");
  expect((await cli(args, directory)).code).toBe(1);
  expect(hash(await Bun.file(providerFile).text())).toBe(first);
}, 30000);
