import { expect, test } from "bun:test";
import { codex } from "../src/adapters/codex.ts";
import { copilot } from "../src/adapters/copilot.ts";
import { composeSubscription } from "../src/compose.ts";
import { subscriptionManifestSchema } from "../src/integration-schema.ts";
import { composedSubscriptionSchema } from "../src/schema.ts";
import { subscriptionManifest } from "../src/subscriptions.ts";
import { initial, upstream } from "./helpers.ts";

const digest = "a".repeat(64);

test("documented subscription integrations do not create model-plan grants", async () => {
  const { registry } = await initial([copilot, codex]);
  const u = await upstream();
  for (const id of ["claude", "google-ai", "kimi", "zai-coding-plan", "minimax-m-plan"]) {
    const view = composeSubscription(u, registry, id, digest);
    expect(view.models).toEqual({});
    expect(view.model_catalog.status).toBe("unknown");
    expect(view.subscription_catalog.sources).toEqual([]);
    expect(view.integration.routes.some((route) => route.support === "documented")).toBe(true);
  }
  const chatgpt = composeSubscription(u, registry, "chatgpt", digest);
  expect(
    chatgpt.model_catalog.products.find((product) => product.id === "openai-codex")?.status,
  ).toBe("partial");
  expect(
    chatgpt.model_catalog.products.find((product) => product.id === "openai-chatgpt-plan-api")
      ?.status,
  ).toBe("unknown");
  registry.providers.forEach((owner) => {
    owner.state = "stale";
    owner.error = "source-http";
  });
  const historical = composeSubscription(u, registry, "chatgpt", digest);
  expect(
    historical.model_catalog.products.find((product) => product.id === "openai-codex")?.state,
  ).toBe("stale");
  for (const owner of registry.providers)
    owner.claims = owner.claims.filter((claim) => claim.channel === "api");
  expect(composeSubscription(u, registry, "chatgpt", digest).model_catalog.status).toBe("unknown");
});

test("integration metadata distinguishes native clients, token reuse, and subscription API keys", async () => {
  const { registry } = await initial([copilot, codex]);
  const u = await upstream();
  const claude = composeSubscription(u, registry, "claude", digest);
  expect(
    claude.integration.routes.find((route) => route.kind === "cli")?.required_clients,
  ).toContain("Claude Code");
  expect(claude.integration.routes.find((route) => route.kind === "direct-api")?.support).toBe(
    "not-supported",
  );
  expect(claude.integration.routes.find((route) => route.kind === "sdk")?.support).toBe(
    "not-supported",
  );
  const google = composeSubscription(u, registry, "google-ai", digest);
  expect(google.integration.routes.find((route) => route.kind === "cli")?.protocols).toContain(
    "acp-json-rpc-stdio",
  );
  expect(google.integration.routes.find((route) => route.kind === "direct-api")?.support).toBe(
    "not-supported",
  );
  const kimi = composeSubscription(u, registry, "kimi", digest);
  expect(
    kimi.integration.routes.find((route) => route.kind === "direct-api")?.auth_methods,
  ).toEqual(["api-key"]);
  expect(kimi.integration.routes.every((route) => route.automation === "restricted")).toBe(true);
  const minimax = composeSubscription(u, registry, "minimax-m-plan", digest);
  expect(
    minimax.integration.routes.some(
      (route) =>
        route.kind === "direct-api" &&
        !route.required_clients.length &&
        route.third_party_use === "supported",
    ),
  ).toBe(true);
  const zai = composeSubscription(u, registry, "zai-coding-plan", digest);
  expect(zai.integration.routes.every((route) => route.third_party_use === "restricted")).toBe(
    true,
  );
});

test("manifest and public response validation reject lost evidence and contradictory routes", async () => {
  const mutations = [
    (candidate: typeof subscriptionManifest) => {
      candidate.subscriptions.push(structuredClone(candidate.subscriptions[0] ?? missing()));
    },
    (candidate: typeof subscriptionManifest) => {
      first(candidate).integration.sources = [];
    },
    (candidate: typeof subscriptionManifest) => {
      route(candidate).evidence = ["missing-source"];
    },
    (candidate: typeof subscriptionManifest) => {
      route(candidate).products = ["unowned-product"];
    },
    (candidate: typeof subscriptionManifest) => {
      route(candidate).support = "not-supported";
      route(candidate).third_party_use = "supported";
    },
    (candidate: typeof subscriptionManifest) => {
      route(candidate).support = "documented";
      route(candidate).kind = "sdk";
      route(candidate).required_clients = [];
    },
    (candidate: typeof subscriptionManifest) => {
      const source = first(candidate).integration.sources[0] ?? missing();
      source.sha256 = "invalid";
    },
    (candidate: typeof subscriptionManifest) => {
      const source = first(candidate).integration.sources[0] ?? missing();
      source.url = "http://example.com";
    },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(subscriptionManifest);
    mutate(candidate);
    expect(subscriptionManifestSchema.safeParse(candidate).success).toBe(false);
  }
  const { registry } = await initial([codex]);
  const view = composeSubscription(await upstream(), registry, "chatgpt", digest);
  const entry = view.integration.routes[0] ?? missing();
  entry.evidence = ["missing-source"];
  expect(composedSubscriptionSchema.safeParse(view).success).toBe(false);
});

function missing(): never {
  throw new Error("Missing test source");
}
function first(manifest: typeof subscriptionManifest) {
  return manifest.subscriptions[0] ?? missing();
}
function route(manifest: typeof subscriptionManifest) {
  return first(manifest).integration.routes[0] ?? missing();
}
