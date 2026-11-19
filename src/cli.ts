import { lstat, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { codex } from "./adapters/codex.ts";
import { copilot } from "./adapters/copilot.ts";
import { publicCatalogAdapters } from "./adapters/public.ts";
import { createCatalogComposer, ModelCatalogUnavailableError } from "./compose.ts";
import {
  composeConnections,
  connectionSchema,
  connectionsSchema,
  discoveryProfiles,
} from "./connections.ts";
import { coverage } from "./coverage.ts";
import { discoveryProfilesSchema } from "./discovery.ts";
import { emptyRegistry, synchronize, upstreamUrl, validateRegistry } from "./engine.ts";
import { fetchText, publicLoader, type Snapshot, type SourceLoader } from "./fetch.ts";
import { subscriptionManifestSchema } from "./integration-schema.ts";
import { composeModelResearch, modelResearch, modelResearchSchema } from "./model-research.ts";
import { modelSources, modelSourcesSchema } from "./model-sources.ts";
import {
  composedProviderResearchSchema,
  composeProviderResearch,
  providerResearch,
} from "./provider-research.ts";
import {
  aliasesSchema,
  type ComposedSubscription,
  composedProviderSchema,
  composedSubscriptionSchema,
  type Registry,
  registrySchema,
  type Upstream,
  upstreamSchema,
} from "./schema.ts";
import { compare, hash, stable } from "./stable.ts";
import { subscriptionCoverage, subscriptionManifest, subscriptions } from "./subscriptions.ts";

const adapters = [copilot, codex, ...publicCatalogAdapters];
const args = process.argv.slice(2);
const command = args.shift();
const supported = new Set(["--fixtures", "--upstream", "--output", "--report-dir"]);
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  const value = args[i + 1];
  if (!key || !supported.has(key) || !value || value.startsWith("--") || options.has(key))
    throw new Error("Invalid CLI options");
  options.set(key, value);
}
const catalogPath = options.get("--output") ?? "data/catalog.json";
const reportDir = options.get("--report-dir") ?? ".artifacts/reports/sync";
async function write(file: string, value: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await Bun.write(temporary, value);
  await rename(temporary, file);
}
async function readRegistry(): Promise<Registry> {
  const file = Bun.file(catalogPath);
  return (await file.exists()) ? validateRegistry(await file.json()) : emptyRegistry();
}
async function sync(): Promise<void> {
  const previous = await readRegistry();
  const now = new Date().toISOString();
  const fixtureDir = options.get("--fixtures");
  const selectedAdapters = fixtureDir
    ? z
        .array(z.string())
        .min(1)
        .parse(await Bun.file(path.join(fixtureDir, "adapters.json")).json())
        .map((id) => {
          const adapter = adapters.find((item) => item.id === id);
          if (!adapter) throw new Error(`Unknown fixture adapter: ${id}`);
          return adapter;
        })
    : adapters;
  const liveLoader = publicLoader(fetch, process.env.GITHUB_TOKEN);
  const loader: SourceLoader = fixtureDir
    ? async ({ id }) => (await Bun.file(path.join(fixtureDir, `${id}.json`)).json()) as Snapshot
    : async (source) => {
        const snapshot = await liveLoader(source);
        await write(path.join(reportDir, "inputs", `${source.id}.json`), stable(snapshot));
        return snapshot;
      };
  let upstream: Upstream;
  try {
    const file =
      options.get("--upstream") ??
      (fixtureDir ? path.join(fixtureDir, "upstream.json") : undefined);
    const body = file ? await Bun.file(file).text() : await fetchText(upstreamUrl);
    upstream = upstreamSchema.parse(JSON.parse(body));
    await write(path.join(reportDir, "inputs", "upstream.json"), body);
    await write(
      path.join(reportDir, "upstream.json"),
      stable({ url: upstreamUrl, sha256: hash(body), checked_at: now }),
    );
  } catch {
    const registry: Registry = {
      ...previous,
      providers: previous.providers.map((provider) => ({
        ...provider,
        state: "stale",
        error: "upstream-failure",
      })),
    };
    if (previous.providers.length) await write(catalogPath, stable(validateRegistry(registry)));
    await write(
      path.join(reportDir, "report.md"),
      "# Synchronization report\n\nUpstream failed. Previous provider data retained and marked stale.\n",
    );
    await write(
      path.join(reportDir, "health.json"),
      stable({
        checked_at: now,
        state: "failed",
        failures: [{ provider: "upstream", code: "upstream-failure" }],
        verified: [],
      }),
    );
    process.exitCode = 1;
    return;
  }
  const result = await synchronize({
    previous,
    upstream,
    adapters: selectedAdapters,
    loader,
    aliases: aliasesSchema.parse(await Bun.file("data/aliases.json").json()),
    now,
  });
  if (result.registry.providers.length) await write(catalogPath, stable(result.registry));
  await write(path.join(reportDir, "report.md"), result.report);
  await write(
    path.join(reportDir, "health.json"),
    stable({
      checked_at: now,
      state: result.failures.length ? "partial-failure" : "ok",
      verified: result.verified,
      failures: result.failures,
      catalog_sha256: hash(stable(result.registry)),
    }),
  );
  console.log(result.report);
  if (result.failures.length) process.exitCode = 1;
}
async function validate(): Promise<Registry> {
  const registry = validateRegistry(await Bun.file(catalogPath).json());
  if (!registry.providers.length) throw new Error("Catalog has no providers");
  const expected = stable(z.toJSONSchema(registrySchema));
  if ((await Bun.file("schemas/catalog.schema.json").text()) !== expected)
    throw new Error("JSON schema is outdated; run bun src/cli.ts schema");
  for (const [name, schema] of [
    ["provider", composedProviderSchema],
    ["subscription", composedSubscriptionSchema],
    ["subscriptions", subscriptionManifestSchema],
    ["provider-research", composedProviderResearchSchema],
    ["connections", connectionsSchema],
    ["connection", connectionSchema],
    ["connection-discovery", discoveryProfilesSchema],
    ["model-sources", modelSourcesSchema],
    ["model-research", modelResearchSchema],
  ] as const) {
    if ((await Bun.file(`schemas/${name}.schema.json`).text()) !== stable(z.toJSONSchema(schema)))
      throw new Error(`${name} JSON schema is outdated; run bun src/cli.ts schema`);
  }
  if (
    (await Bun.file(new URL("../data/subscriptions.json", import.meta.url)).text()) !==
    stable(subscriptionManifest)
  )
    throw new Error("Subscription manifest is not canonically formatted");
  if (
    (await Bun.file(new URL("../data/provider-research.json", import.meta.url)).text()) !==
    stable(providerResearch)
  )
    throw new Error("Provider research is not canonically formatted");
  for (const [name, value] of [
    ["model-sources", modelSources],
    ["connection-discovery", discoveryProfiles],
    ["model-research", modelResearch],
  ] as const) {
    if ((await Bun.file(new URL(`../data/${name}.json`, import.meta.url)).text()) !== stable(value))
      throw new Error(`${name} is not canonically formatted`);
  }
  for (const review of providerResearch.providers) {
    if (review.subscription_ids.some((id) => !subscriptions.some((item) => item.id === id)))
      throw new Error(`Unknown reviewed subscription namespace: ${review.provider_id}`);
  }
  if ((await Bun.file(catalogPath).text()) !== stable(registry))
    throw new Error("Catalog is not canonically formatted");
  console.log(
    `Validated ${registry.providers.length} providers and ${registry.providers.reduce((sum, item) => sum + item.claims.length, 0)} claims.`,
  );
  return registry;
}
function segment(value: string): string {
  if (value === "." || value === "..") throw new Error("Invalid static path segment");
  return encodeURIComponent(value);
}
async function build(): Promise<void> {
  const registry = await validate();
  const upstreamFile = options.get("--upstream");
  const upstreamBody = upstreamFile
    ? await Bun.file(upstreamFile).text()
    : await fetchText(upstreamUrl);
  const upstream = upstreamSchema.parse(JSON.parse(upstreamBody));
  const upstreamDigest = hash(upstreamBody);
  const composer = createCatalogComposer(upstream, registry, upstreamDigest);
  await write(path.join(reportDir, "inputs", "build-upstream.json"), upstreamBody);
  const marker = "swarmie-catalog generated output\n";
  const output = await lstat("dist").catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (output) {
    if (
      !output.isDirectory() ||
      !(await Bun.file("dist/.catalog-build").exists()) ||
      (await Bun.file("dist/.catalog-build").text()) !== marker
    ) {
      throw new Error("Refusing to replace an unowned dist directory");
    }
    await rm("dist", { recursive: true });
  }
  await write("dist/.catalog-build", marker);
  await write("dist/catalog.json", stable(registry));
  await write("dist/coverage.json", stable(coverage(registry)));
  await write(
    "dist/health.json",
    stable({
      catalog_sha256: hash(stable(registry)),
      providers: registry.providers.map((provider) => ({
        id: provider.id,
        state: provider.state,
        error: provider.error,
        source_updated_at: provider.source_updated_at,
      })),
    }),
  );
  await write("dist/catalog.schema.json", await Bun.file("schemas/catalog.schema.json").text());
  await write("dist/provider.schema.json", await Bun.file("schemas/provider.schema.json").text());
  await write(
    "dist/subscription.schema.json",
    await Bun.file("schemas/subscription.schema.json").text(),
  );
  await write("dist/subscriptions.json", stable(subscriptionManifest));
  await write(
    "dist/subscriptions.schema.json",
    await Bun.file("schemas/subscriptions.schema.json").text(),
  );
  const connectionCatalog = composeConnections(upstream, upstreamDigest, registry);
  await write("dist/connections.json", stable(connectionCatalog));
  await write(
    "dist/connection.schema.json",
    await Bun.file("schemas/connection.schema.json").text(),
  );
  for (const connection of connectionCatalog.connections) {
    await write(`dist/${connection.path}`, stable(connection));
  }
  const connectionGroups = [
    {
      id: "direct-subscriptions",
      connections: connectionCatalog.connections.filter(
        (connection) =>
          connection.execution === "direct-model" && connection.billing.kind === "subscription",
      ),
    },
    {
      id: "direct-api",
      connections: connectionCatalog.connections.filter(
        (connection) =>
          connection.execution === "direct-model" && connection.billing.subscription_id === null,
      ),
    },
    {
      id: "coding-agents",
      connections: connectionCatalog.connections.filter(
        (connection) => connection.execution === "coding-agent",
      ),
    },
  ];
  for (const group of connectionGroups) {
    await write(
      `dist/connections/${group.id}.json`,
      stable({ ...connectionCatalog, connections: group.connections }),
    );
  }
  const connectionServices = [
    ...new Set(connectionCatalog.connections.map((connection) => connection.service_id)),
  ].sort(compare);
  for (const service of connectionServices) {
    await write(
      `dist/connections/services/${segment(service)}/index.json`,
      stable({
        ...connectionCatalog,
        connections: connectionCatalog.connections.filter(
          (connection) => connection.service_id === service,
        ),
      }),
    );
  }
  for (const provider of Object.keys(upstream.providers).sort(compare)) {
    await write(
      `dist/connections/providers/${segment(provider)}.json`,
      stable({
        ...connectionCatalog,
        connections: connectionCatalog.connections.filter((connection) =>
          connection.provider_ids.includes(provider),
        ),
      }),
    );
  }
  await write(
    "dist/connections.schema.json",
    await Bun.file("schemas/connections.schema.json").text(),
  );
  await write(
    "dist/provider-research.json",
    stable(composeProviderResearch(upstream, upstreamDigest)),
  );
  await write(
    "dist/provider-research.schema.json",
    await Bun.file("schemas/provider-research.schema.json").text(),
  );
  for (const [name, value] of [
    ["model-sources", modelSources],
    ["connection-discovery", discoveryProfiles],
    ["model-research", composeModelResearch(upstream)],
  ] as const) {
    await write(`dist/${name}.json`, stable(value));
    await write(`dist/${name}.schema.json`, await Bun.file(`schemas/${name}.schema.json`).text());
  }
  const providers: { id: string; path: string }[] = [];
  for (const providerId of Object.keys(upstream.providers).sort(compare)) {
    const provider = composer.provider(providerId);
    const providerPath = `providers/${segment(providerId)}.json`;
    await write(`dist/${providerPath}`, stable(provider));
    providers.push({ id: providerId, path: providerPath });
  }
  const subscriptionRoutes = [];
  const unavailableSubscriptions = [];
  for (const id of subscriptions.map((definition) => definition.id).sort(compare)) {
    let subscription: ComposedSubscription;
    try {
      subscription = composer.subscription(id);
    } catch (error) {
      if (!(error instanceof ModelCatalogUnavailableError)) throw error;
      const definition = subscriptions.find((item) => item.id === id);
      if (!definition) throw error;
      unavailableSubscriptions.push({
        id,
        name: definition.name,
        reason: "no-qualified-public-model-source",
        model_catalog: subscriptionCoverage(registry, definition.products),
        sources: definition.integration.sources,
      });
      continue;
    }
    const subscriptionPath = `subscriptions/${segment(id)}.json`;
    await write(`dist/${subscriptionPath}`, stable(subscription));
    subscriptionRoutes.push({
      id,
      name: subscription.name,
      products: subscription.products,
      model_catalog: subscription.model_catalog,
      path: subscriptionPath,
    });
  }
  await write(
    "dist/subscription-coverage.json",
    stable({
      schema_version: 1,
      available: subscriptionRoutes,
      unavailable: unavailableSubscriptions,
    }),
  );
  await write(
    "dist/index.json",
    stable({
      schema_version: 4,
      model_selection: "connection-discovery-required",
      upstream: { url: upstreamUrl, sha256: upstreamDigest },
      catalog: "catalog.json",
      provider_schema: "provider.schema.json",
      subscription_schema: "subscription.schema.json",
      subscription_manifest: "subscriptions.json",
      subscription_manifest_schema: "subscriptions.schema.json",
      provider_research: "provider-research.json",
      provider_research_schema: "provider-research.schema.json",
      connections: "connections.json",
      connections_schema: "connections.schema.json",
      connection_schema: "connection.schema.json",
      connection_discovery: "connection-discovery.json",
      connection_discovery_schema: "connection-discovery.schema.json",
      connection_groups: connectionGroups.map(({ id }) => ({ id, path: `connections/${id}.json` })),
      connection_services: connectionServices.map((id) => ({
        id,
        path: `connections/services/${segment(id)}/index.json`,
      })),
      subscription_coverage: "subscription-coverage.json",
      model_sources: "model-sources.json",
      model_research: "model-research.json",
      subscriptions: subscriptionRoutes,
      notices: "THIRD_PARTY_NOTICES.md",
      providers,
    }),
  );
  const notices = await Bun.file(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url)).text();
  await write(
    "dist/THIRD_PARTY_NOTICES.md",
    notices.replaceAll("tests/fixtures/licenses/", "licenses/"),
  );
  for (const name of [
    "codex-license.txt",
    "codex-notice.txt",
    "github-docs-license.txt",
    "models-dev-license.txt",
  ]) {
    await write(
      `dist/licenses/${name}`,
      await Bun.file(new URL(`../tests/fixtures/licenses/${name}`, import.meta.url)).text(),
    );
  }
  await write("dist/.nojekyll", "");
  console.log("Static catalog written to dist/.");
}
try {
  if (command === "sync") await sync();
  else if (command === "validate") await validate();
  else if (command === "build") await build();
  else if (command === "schema") {
    await write("schemas/catalog.schema.json", stable(z.toJSONSchema(registrySchema)));
    await write("schemas/provider.schema.json", stable(z.toJSONSchema(composedProviderSchema)));
    await write(
      "schemas/subscription.schema.json",
      stable(z.toJSONSchema(composedSubscriptionSchema)),
    );
    await write(
      "schemas/subscriptions.schema.json",
      stable(z.toJSONSchema(subscriptionManifestSchema)),
    );
    await write(
      "schemas/provider-research.schema.json",
      stable(z.toJSONSchema(composedProviderResearchSchema)),
    );
    await write("schemas/connections.schema.json", stable(z.toJSONSchema(connectionsSchema)));
    await write("schemas/connection.schema.json", stable(z.toJSONSchema(connectionSchema)));
    await write(
      "schemas/connection-discovery.schema.json",
      stable(z.toJSONSchema(discoveryProfilesSchema)),
    );
    await write("schemas/model-sources.schema.json", stable(z.toJSONSchema(modelSourcesSchema)));
    await write("schemas/model-research.schema.json", stable(z.toJSONSchema(modelResearchSchema)));
  } else
    throw new Error(
      "Usage: bun src/cli.ts sync|validate|build|schema [--fixtures DIR] [--upstream FILE] [--output FILE] [--report-dir DIR]",
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Command failed");
  process.exitCode = 1;
}
