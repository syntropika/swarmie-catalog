import { describe, expect, test } from "bun:test";
import { codex } from "../src/adapters/codex.ts";
import { copilot } from "../src/adapters/copilot.ts";
import type { Adapter } from "../src/adapters/types.ts";
import { emptyRegistry, synchronize, validateRegistry } from "../src/engine.ts";
import { SyncError } from "../src/fetch.ts";
import { enrich, query } from "../src/index.ts";
import { copilotSlug, reconcile } from "../src/reconcile.ts";
import { claimSchema, upstreamSchema } from "../src/schema.ts";
import { hash, stable } from "../src/stable.ts";
import { fixtureLoader, initial, now, upstream } from "./helpers.ts";

const adapters = [copilot, codex];
async function run(previous = emptyRegistry(), selected = adapters) {
  return synchronize({
    previous,
    upstream: await upstream(),
    adapters: selected,
    loader: fixtureLoader,
    aliases: {},
    now,
  });
}
function altered(
  adapter: Adapter,
  change: (claims: ReturnType<Adapter["parse"]>) => ReturnType<Adapter["parse"]>,
): Adapter {
  return { ...adapter, parse: (sources) => change(adapter.parse(sources)) };
}
describe("identity and contracts", () => {
  test("uses upstream canonical links, reports variants and unknown IDs", async () => {
    const catalog = await initial(adapters);
    const copilotClaims =
      catalog.registry.providers.find((provider) => provider.id === copilot.id)?.claims ?? [];
    expect(copilotClaims.find((claim) => claim.source_model === "Claude Haiku 4.5")?.model_id).toBe(
      "anthropic/claude-haiku-4-5",
    );
    expect(
      copilotClaims.find((claim) => claim.source_model.includes("fast mode"))?.model_id,
    ).toBeNull();
    expect(copilotSlug("GPT-5.3-Codex")).toBe("gpt-5.3-codex");
  });
  test("explicit aliases resolve exactly and absent targets fail", async () => {
    const claims = codex.parse(await codex.load(fixtureLoader));
    const claim = claims[0];
    if (!claim) throw new Error("Missing fixture claim");
    const u = await upstream();
    const alias = {
      model_id: "openai/gpt-6-sol",
      variant: "test",
      reason: "test alias",
      source: "https://example.org/evidence",
    };
    expect(
      reconcile({ ...claim, source_model: "test-alias" }, u, { "openai-codex:test-alias": alias })
        .model_id,
    ).toBe(alias.model_id);
    expect(
      reconcile({ ...claim, source_model: "test alias" }, u, { "openai-codex:test-alias": alias })
        .model_id,
    ).toBeNull();
    expect(() =>
      reconcile(claim, u, {
        [`${claim.product}:${claim.source_model}`]: { ...alias, model_id: "missing/model" },
      }),
    ).toThrow();
  });
  test("validates required claims and keyed upstream identities", async () => {
    expect(() => claimSchema.parse({ status: "available" })).toThrow();
    const u = await upstream();
    u.models.broken = { id: "wrong", name: "Wrong" };
    expect(() => upstreamSchema.parse(u)).toThrow();
  });
  test("rejects dangling provenance and duplicate providers", async () => {
    const { registry } = await initial(adapters);
    const provider = registry.providers[0];
    if (!provider) throw new Error("Missing fixture provider");
    expect(() =>
      validateRegistry({ ...registry, providers: [...registry.providers, provider] }),
    ).toThrow();
    expect(() =>
      validateRegistry({ ...registry, providers: [{ ...provider, sources: [] }] }),
    ).toThrow();
  });
});
describe("failure isolation and deletion protection", () => {
  test("mass loss of upstream canonical links preserves the last valid provider", async () => {
    const previous = (await run()).registry;
    const catalog = await upstream();
    delete catalog.providers["github-copilot"];
    const result = await synchronize({
      previous,
      upstream: catalog,
      adapters: [copilot],
      loader: fixtureLoader,
      aliases: {},
      now,
    });
    expect(result.failures[0]?.code).toBe("mass-identity-loss");
    expect(result.registry.providers.find((provider) => provider.id === copilot.id)?.state).toBe(
      "stale",
    );
  });
  test("failed providers retain all claims and successful providers still update", async () => {
    const previous = (await run()).registry;
    const failure: Adapter = {
      ...copilot,
      load: async () => {
        throw new SyncError("source-http", "HTTP 503");
      },
    };
    const result = await run(previous, [
      failure,
      altered(codex, (claims) =>
        claims.map((claim) =>
          claim.plan === "plus" ? { ...claim, status: "unknown", reason: "test-policy" } : claim,
        ),
      ),
    ]);
    expect(result.failures).toHaveLength(1);
    expect(result.registry.providers.find((provider) => provider.id === copilot.id)?.state).toBe(
      "stale",
    );
    expect(
      result.registry.providers.find((provider) => provider.id === copilot.id)?.claims,
    ).toEqual(previous.providers.find((provider) => provider.id === copilot.id)?.claims);
    expect(result.verified).toContain(codex.id);
    expect(query(result.registry, { product: copilot.id })).toHaveLength(0);
    const recovered = await run(result.registry);
    expect(recovered.failures).toHaveLength(0);
    expect(recovered.registry.providers.every((provider) => provider.state === "current")).toBe(
      true,
    );
  });
  test("empty results, mass removal, and mass denial retain prior data", async () => {
    const previous = (await run()).registry;
    for (const adapter of [
      altered(codex, () => []),
      altered(codex, (claims) => claims.filter((claim) => claim.source_model === "gpt-6-sol")),
      altered(codex, (claims) => claims.map((claim) => ({ ...claim, status: "unavailable" }))),
    ]) {
      const result = await run(previous, [adapter]);
      expect(result.failures).toHaveLength(1);
      expect(result.registry.providers.find((provider) => provider.id === codex.id)?.state).toBe(
        "stale",
      );
    }
  });
  test("one disappearing model becomes unknown and retains original evidence", async () => {
    const previous = (await run()).registry;
    const result = await run(previous, [
      altered(copilot, (claims) => claims.filter((claim) => claim.source_model !== "Grok 4.5")),
    ]);
    expect(result.failures).toHaveLength(0);
    const missing =
      result.registry.providers
        .find((provider) => provider.id === copilot.id)
        ?.claims.filter((claim) => claim.source_model === "Grok 4.5") ?? [];
    expect(missing.length).toBeGreaterThan(0);
    expect(
      missing.every(
        (claim) => claim.status === "unknown" && claim.reason === "source-no-longer-lists-scope",
      ),
    ).toBe(true);
    validateRegistry(result.registry);
  });
  test("conflicts fail the provider; identical records deduplicate", async () => {
    const previous = (await run()).registry;
    const identical = await run(previous, [altered(codex, (claims) => [...claims, ...claims])]);
    expect(identical.failures).toHaveLength(0);
    expect(identical.changed).toBe(false);
    const conflict = await run(previous, [
      altered(codex, (claims) => [
        ...claims,
        ...claims.map((claim) => ({ ...claim, status: "unavailable" as const })),
      ]),
    ]);
    expect(conflict.failures[0]?.code).toBe("conflicting-evidence");
  });
  test("mismatched source digest never verifies claims", async () => {
    const result = await synchronize({
      previous: emptyRegistry(),
      upstream: await upstream(),
      adapters: [codex],
      aliases: {},
      now,
      loader: async (repo, path, id) => ({ ...(await fixtureLoader(repo, path, id)), body: "{}" }),
    });
    expect(result.failures).toHaveLength(1);
    expect(result.registry.providers).toHaveLength(0);
  });
});
describe("determinism and consumption", () => {
  test("fresh generations remain identical when a proposed PR has not been merged", async () => {
    const first = await run();
    const second = await synchronize({
      previous: emptyRegistry(),
      upstream: await upstream(),
      adapters,
      loader: fixtureLoader,
      aliases: {},
      now: "2026-12-01T00:00:00.000Z",
    });
    expect(stable(second.registry)).toBe(stable(first.registry));
  });
  test("source whitespace changes do not create meaningless catalog diffs", async () => {
    const first = await run();
    const next = await synchronize({
      previous: first.registry,
      upstream: await upstream(),
      adapters,
      aliases: {},
      now: "2026-12-01T00:00:00.000Z",
      loader: async (repo, path, id) => {
        const snapshot = await fixtureLoader(repo, path, id);
        const body = `${snapshot.body}\n`;
        return { ...snapshot, body, source: { ...snapshot.source, sha256: hash(body) } };
      },
    });
    expect(next.failures).toHaveLength(0);
    expect(next.changed).toBe(false);
    expect(stable(next.registry)).toBe(stable(first.registry));
  });
  test("identical inputs produce byte-identical files even at a later check time", async () => {
    const first = await run();
    const next = await synchronize({
      previous: first.registry,
      upstream: await upstream(),
      adapters: [...adapters].reverse(),
      loader: fixtureLoader,
      aliases: {},
      now: "2026-12-01T00:00:00.000Z",
    });
    expect(stable(next.registry)).toBe(stable(first.registry));
    expect(next.changed).toBe(false);
    const reordered = await run(
      first.registry,
      adapters.map((adapter) => altered(adapter, (claims) => [...claims].reverse())),
    );
    expect(stable(reordered.registry)).toBe(stable(first.registry));
  });
  test("query scopes plans to product, filters unresolved, and supports both channels", async () => {
    const { registry } = await run();
    const claims = query(registry, {
      product: codex.id,
      plan: "plus",
      channel: "subscription",
      status: "available",
    });
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every((claim) => claim.product === codex.id && claim.plan === "plus")).toBe(true);
    const channels = new Set(
      query(registry, { model: "openai/gpt-6-sol" }).map((claim) => claim.channel),
    );
    expect([...channels].sort()).toEqual(["api", "subscription"]);
    expect(query(registry).every((claim) => claim.model_id !== null)).toBe(true);
    const u = await upstream();
    const original = stable(u);
    const joined = enrich(u, registry);
    expect(joined["openai/gpt-6-sol"]?.metadata).toEqual(u.models["openai/gpt-6-sol"]);
    expect(stable(u)).toBe(original);
  });
});
