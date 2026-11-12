import { expect, test } from "bun:test";
import { codex } from "../src/adapters/codex.ts";
import { copilot } from "../src/adapters/copilot.ts";
import { composeProvider, selectSubscriptionModels } from "../src/compose.ts";
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
  expect(subscription_access.status).toBe("available");
  expect(new Set(subscription_access.offers.map((offer) => offer.product))).toEqual(
    new Set(["openai-codex", "github-copilot"]),
  );
  expect(subscription_access.offers.every((offer) => offer.channel === "subscription")).toBe(true);
  expect(result.subscription_catalog.upstream.sha256).toBe(digest);
  const sources = new Set(result.subscription_catalog.sources.map((source) => source.id));
  expect(
    subscription_access.offers.every((offer) =>
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
  expect(result.models["new-model"]?.subscription_access).toEqual({
    status: "unknown",
    model_id: "openai/new-model",
    reason: "no-source-evidence",
    offers: [],
  });
  expect(selectSubscriptionModels(result).models["new-model"]).toBeUndefined();
});

test("plan selection is scoped to its product and excludes stale declarations", async () => {
  const u = await upstream();
  const { registry } = await initial([copilot, codex]);
  const result = composeProvider(u, registry, "openai", digest);
  const plus = selectSubscriptionModels(result, { product: "openai-codex", plan: "plus" });
  expect(Object.keys(plus.models).length).toBeGreaterThan(0);
  expect(
    Object.values(plus.models).every((model) =>
      model.subscription_access.offers.some(
        (offer) =>
          offer.product === "openai-codex" &&
          offer.plan === "plus" &&
          offer.status === "available" &&
          offer.state === "current",
      ),
    ),
  ).toBe(true);
  expect(() => selectSubscriptionModels(result, { plan: "plus" })).toThrow();
  const stale = {
    ...registry,
    providers: registry.providers.map((provider) => ({
      ...provider,
      state: "stale" as const,
      error: "source-http",
    })),
  };
  const historical = composeProvider(u, stale, "openai", digest);
  expect(historical.models["gpt-6-sol"]?.subscription_access.status).toBe("unknown");
  expect(Object.keys(selectSubscriptionModels(historical).models)).toHaveLength(0);
  expect(historical.models["gpt-6-sol"]?.subscription_access.offers.length).toBeGreaterThan(0);
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
  expect(broken.models.invalid?.subscription_access.model_id).toBeNull();
  expect(broken.models.invalid?.subscription_access.status).toBe("unknown");
  expect(broken.models["gpt-6-sol"]?.subscription_access.offers).toEqual([]);
});
