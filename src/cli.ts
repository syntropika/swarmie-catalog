import { lstat, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { codex } from "./adapters/codex.ts";
import { copilot } from "./adapters/copilot.ts";
import { composeProvider, selectSubscriptionModels } from "./compose.ts";
import { coverage } from "./coverage.ts";
import { emptyRegistry, synchronize, upstreamUrl, validateRegistry } from "./engine.ts";
import { fetchText, githubLoader, type Snapshot, type SourceLoader } from "./fetch.ts";
import {
  aliasesSchema,
  composedProviderSchema,
  type Registry,
  registrySchema,
  type Upstream,
  upstreamSchema,
} from "./schema.ts";
import { compare, hash, stable } from "./stable.ts";

const adapters = [copilot, codex];
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
  const loader: SourceLoader = fixtureDir
    ? async (_repo, _path, id) =>
        (await Bun.file(path.join(fixtureDir, `${id}.json`)).json()) as Snapshot
    : async (repo, sourcePath, id) => {
        const snapshot = await githubLoader(fetch, process.env.GITHUB_TOKEN)(repo, sourcePath, id);
        await write(path.join(reportDir, "inputs", `${id}.json`), stable(snapshot));
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
    adapters,
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
  if (
    (await Bun.file("schemas/provider.schema.json").text()) !==
    stable(z.toJSONSchema(composedProviderSchema))
  )
    throw new Error("Provider JSON schema is outdated; run bun src/cli.ts schema");
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
  const providers: {
    id: string;
    path: string;
    subscriptions: string;
    products: { id: string; path: string; plans: { id: string; path: string }[] }[];
  }[] = [];
  for (const providerId of Object.keys(upstream.providers).sort(compare)) {
    const provider = composeProvider(upstream, registry, providerId, upstreamDigest);
    const prefix = `providers/${segment(providerId)}`;
    const providerPath = `${prefix}.json`;
    const subscriptionsPath = `${prefix}/subscriptions.json`;
    await write(`dist/${providerPath}`, stable(provider));
    await write(`dist/${subscriptionsPath}`, stable(selectSubscriptionModels(provider)));
    const offers = Object.values(provider.models).flatMap(
      (model) => model.subscription_access.offers,
    );
    const productIds = [...new Set(offers.map((offer) => offer.product))].sort(compare);
    const products = [];
    for (const product of productIds) {
      const productPath = `${prefix}/products/${segment(product)}.json`;
      await write(`dist/${productPath}`, stable(selectSubscriptionModels(provider, { product })));
      const plans = [
        ...new Set(
          offers.flatMap((offer) =>
            offer.product === product && offer.plan !== null ? [offer.plan] : [],
          ),
        ),
      ].sort(compare);
      const entries = [];
      for (const plan of plans) {
        const planPath = `${prefix}/products/${segment(product)}/plans/${segment(plan)}.json`;
        await write(
          `dist/${planPath}`,
          stable(selectSubscriptionModels(provider, { product, plan })),
        );
        entries.push({ id: plan, path: planPath });
      }
      products.push({ id: product, path: productPath, plans: entries });
    }
    providers.push({
      id: providerId,
      path: providerPath,
      subscriptions: subscriptionsPath,
      products,
    });
  }
  await write(
    "dist/index.json",
    stable({
      schema_version: 1,
      upstream: { url: upstreamUrl, sha256: upstreamDigest },
      catalog: "catalog.json",
      provider_schema: "provider.schema.json",
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
  } else
    throw new Error(
      "Usage: bun src/cli.ts sync|validate|build|schema [--fixtures DIR] [--upstream FILE] [--output FILE] [--report-dir DIR]",
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Command failed");
  process.exitCode = 1;
}
