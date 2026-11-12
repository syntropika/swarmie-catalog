import { expect, test } from "bun:test";
import { codex } from "../src/adapters/codex.ts";
import { copilot } from "../src/adapters/copilot.ts";
import { composeProvider, composeSubscription } from "../src/compose.ts";
import { stable } from "../src/stable.ts";
import { initial, upstream } from "./helpers.ts";

const digest = "a".repeat(64);

test("OpenAI retains upstream metadata and receives Codex and Copilot declarations", async () => {
  const u = await upstream();
  const original = stable(u);
  const { registry } = await initial([copilot, codex]);
  const result = composeProvider(u, registry, "openai", digest);
  expect(result.id).toBe("openai");
  expect(Object.keys(result.models)).toEqual(Object.keys(u.providers.openai?.models ?? {}).sort());
  const model = result.models["gpt-6-sol"];
  if (!model) throw new Error("Missing fixture model");
  const { subscription_access, ...metadata } = model;
  const originalModel = u.providers.openai?.models["gpt-6-sol"];
  if (!originalModel) throw new Error("Missing original fixture model");
  expect(metadata).toEqual(originalModel);
  expect(subscription_access.some((offer) => offer.status === "available")).toBe(true);
  expect(new Set(subscription_access.map((offer) => offer.product))).toEqual(
    new Set(["openai-codex", "github-copilot"]),
  );
  expect(subscription_access.every((offer) => offer.channel === "subscription")).toBe(true);
  expect(result.subscription_catalog.upstream.sha256).toBe(digest);
  const sources = new Set(result.subscription_catalog.sources.map((source) => source.id));
  expect(
    subscription_access.every((offer) =>
      offer.evidence.every((evidence) => sources.has(evidence.source)),
    ),
  ).toBe(true);
  expect(stable(u)).toBe(original);
});

test("absent evidence stays unknown and API membership creates no subscription grant", async () => {
  const u = await upstream();
  const provider = u.providers.openai;
  if (!provider) throw new Error("Missing provider fixture");
  provider.models["new-model"] = { id: "new-model", name: "New model" };
  u.models["openai/new-model"] = { id: "openai/new-model", name: "New model" };
  const { registry } = await initial([codex]);
  const result = composeProvider(u, registry, "openai", digest);
  expect(result.models["new-model"]?.subscription_access).toEqual([]);
});

test("plan vectors preserve product, client, status, and historical conditions", async () => {
  const u = await upstream();
  const { registry } = await initial([copilot, codex]);
  const result = composeProvider(u, registry, "openai", digest);
  const access = result.models["gpt-6-sol"]?.subscription_access ?? [];
  expect(
    access.some(
      (offer) =>
        offer.product === "openai-codex" &&
        offer.plans.includes("plus") &&
        offer.plans.includes("pro") &&
        offer.status === "available" &&
        offer.state === "current",
    ),
  ).toBe(true);
  for (const owner of registry.providers) {
    const claims = owner.claims.filter(
      (claim) => claim.model_id === "openai/gpt-6-sol" && claim.channel === "subscription",
    );
    for (const { plan, evidence, ...conditions } of claims) {
      const group = access.find((offer) => {
        const {
          subscription: _subscription,
          plans: _plans,
          evidence: _evidence,
          state: _state,
          error: _error,
          source_updated_at: _date,
          ...actual
        } = offer;
        return stable(actual) === stable(conditions);
      });
      expect(group?.plans).toContain(plan);
      expect(group?.evidence).toEqual(expect.arrayContaining(evidence));
    }
  }
  const reversed = {
    ...registry,
    providers: [...registry.providers].reverse().map((owner) => ({
      ...owner,
      claims: [...owner.claims]
        .reverse()
        .map((claim) => ({ ...claim, evidence: [...claim.evidence].reverse() })),
    })),
  };
  expect(stable(composeProvider(u, reversed, "openai", digest))).toBe(stable(result));
  const stale = {
    ...registry,
    providers: registry.providers.map((owner) => ({
      ...owner,
      state: "stale" as const,
      error: "source-http",
    })),
  };
  const historical = composeProvider(u, stale, "openai", digest);
  const history = historical.models["gpt-6-sol"]?.subscription_access ?? [];
  expect(history.length).toBeGreaterThan(0);
  expect(history.every((offer) => offer.state === "stale" && offer.error === "source-http")).toBe(
    true,
  );
});

test("composition refuses collisions and reports broken links without guessing", async () => {
  const u = await upstream();
  const { registry } = await initial([codex]);
  const provider = u.providers.openai;
  if (!provider) throw new Error("Missing provider fixture");
  provider.subscription_catalog = {};
  expect(() => composeProvider(u, registry, "openai", digest)).toThrow("collision");
  delete provider.subscription_catalog;
  provider.models.invalid = { id: "invalid", name: "Invalid", canonical_model_id: "missing/model" };
  provider.models["gpt-6-sol"] = {
    id: "gpt-6-sol",
    name: "GPT-6 Sol",
    canonical_model_id: "missing/model",
  };
  const broken = composeProvider(u, registry, "openai", digest);
  expect(broken.models.invalid?.subscription_access).toEqual([]);
  expect(broken.models["gpt-6-sol"]?.subscription_access).toEqual([]);
});

test("grouping keeps unspecified plans and different access conditions separate", async () => {
  const u = await upstream();
  const { registry } = await initial([codex]);
  const owner = registry.providers[0];
  const seed = owner?.claims.find(
    (claim) => claim.model_id === "openai/gpt-6-sol" && claim.channel === "subscription",
  );
  if (!owner || !seed) throw new Error("Missing source fixture");
  const common = {
    ...seed,
    surface: "cli",
    minimum_client_version: null,
    status: "available" as const,
  };
  owner.claims = [
    { ...common, plan: "plus" },
    { ...common, plan: "pro" },
    { ...common, plan: "free", status: "unknown" },
    { ...common, plan: "free", surface: "web", status: "unavailable" },
    { ...common, plan: "plus", minimum_client_version: "2.0" },
    { ...common, plan: null, reason: "unspecified-plan", status: "unknown" },
  ];
  const access =
    composeProvider(u, registry, "openai", digest).models["gpt-6-sol"]?.subscription_access ?? [];
  expect(access).toHaveLength(5);
  const positive = access.filter(
    (entry) => entry.status === "available" && entry.minimum_client_version === null,
  );
  expect(positive).toHaveLength(1);
  expect(positive[0]?.plans).toEqual(["plus", "pro"]);
  expect(access.find((entry) => entry.minimum_client_version === "2.0")?.plans).toEqual(["plus"]);
  expect(access.find((entry) => entry.reason === "unspecified-plan")?.plans).toEqual([null]);
  expect(access.find((entry) => entry.surface === "web")?.status).toBe("unavailable");
  expect(
    access.find((entry) => entry.plans.includes("free") && entry.surface === "cli")?.status,
  ).toBe("unknown");
});

test("subscription routes isolate ChatGPT and Copilot while preserving canonical metadata", async () => {
  const u = await upstream();
  const original = stable(u);
  const { registry } = await initial([copilot, codex]);
  const chatgpt = composeSubscription(u, registry, "chatgpt", digest);
  const github = composeSubscription(u, registry, "github-copilot", digest);
  expect(chatgpt.products).toEqual(["openai-codex"]);
  expect(
    chatgpt.models["openai/gpt-6-sol"]?.subscription_access.some(
      (entry) =>
        entry.subscription === "chatgpt" &&
        entry.product === "openai-codex" &&
        entry.plans.includes("plus"),
    ),
  ).toBe(true);
  expect(github.models["openai/gpt-6-sol"]).toBeDefined();
  expect(github.models["anthropic/claude-fable-5-2"]).toBeDefined();
  for (const subscription of [chatgpt, github]) {
    const sources = new Set(subscription.subscription_catalog.sources.map((source) => source.id));
    expect(subscription.subscription_catalog.upstream.sha256).toBe(digest);
    for (const [id, { subscription_access, ...metadata }] of Object.entries(subscription.models)) {
      const originalModel = u.models[id];
      if (!originalModel) throw new Error("Missing canonical fixture");
      expect(metadata).toEqual(originalModel);
      expect(subscription_access.length).toBeGreaterThan(0);
      expect(
        subscription_access.every(
          (entry) =>
            entry.subscription === subscription.id &&
            subscription.products.includes(entry.product) &&
            entry.evidence.every((evidence) => sources.has(evidence.source)),
        ),
      ).toBe(true);
    }
  }
  const codexOwner = registry.providers.find((owner) => owner.id === "openai-codex");
  if (!codexOwner) throw new Error("Missing Codex source owner");
  expect(chatgpt.subscription_catalog.sources).toEqual(codexOwner.sources);
  expect(stable(u)).toBe(original);
});

test("subscription views retain historical and unknown evidence without guessing missing identities", async () => {
  const u = await upstream();
  const { registry } = await initial([copilot, codex]);
  const owner = registry.providers.find((item) => item.id === "github-copilot");
  if (!owner) throw new Error("Missing Copilot fixture");
  owner.state = "stale";
  owner.error = "source-http";
  const result = composeSubscription(u, registry, "github-copilot", digest);
  const entries = Object.values(result.models).flatMap((model) => model.subscription_access);
  expect(entries.some((entry) => entry.status === "unknown")).toBe(true);
  expect(entries.some((entry) => entry.status === "unavailable")).toBe(true);
  expect(entries.every((entry) => entry.state === "stale" && entry.error === "source-http")).toBe(
    true,
  );
  delete u.models["openai/gpt-6-sol"];
  expect(
    composeSubscription(u, registry, "github-copilot", digest).models["openai/gpt-6-sol"],
  ).toBeUndefined();
  u.models["openai/gpt-6-sol"] = {
    id: "openai/gpt-6-sol",
    name: "Collision",
    subscription_access: [],
  };
  expect(() => composeSubscription(u, registry, "chatgpt", digest)).toThrow("collision");
});

test("subscription composition is deterministic and refuses unknown namespaces", async () => {
  const u = await upstream();
  const { registry } = await initial([copilot, codex]);
  const expected = composeSubscription(u, registry, "chatgpt", digest);
  registry.providers.reverse();
  for (const owner of registry.providers) owner.claims.reverse();
  expect(stable(composeSubscription(u, registry, "chatgpt", digest))).toBe(stable(expected));
  expect(() => composeSubscription(u, registry, "openai", digest)).toThrow("Unknown subscription");
  const owner = registry.providers.find((item) => item.id === "openai-codex");
  const seed = owner?.claims.find((claim) => claim.model_id !== null);
  if (!owner || !seed) throw new Error("Missing Codex fixture");
  owner.id = "unsupported-product";
  owner.claims = [{ ...seed, product: owner.id, channel: "subscription" }];
  expect(() => composeSubscription(u, registry, "chatgpt", digest)).toThrow(
    "Unknown subscription product",
  );
});
