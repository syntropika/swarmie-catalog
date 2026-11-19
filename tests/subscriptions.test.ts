import { expect, test } from "bun:test";
import { codex } from "../src/adapters/codex.ts";
import { copilot } from "../src/adapters/copilot.ts";
import { composeSubscription, ModelCatalogUnavailableError } from "../src/compose.ts";
import { subscriptionManifestSchema } from "../src/integration-schema.ts";
import { composedSubscriptionSchema } from "../src/schema.ts";
import { subscriptionCoverage, subscriptionManifest } from "../src/subscriptions.ts";
import { initial, upstream } from "./helpers.ts";

const digest = "a".repeat(64);

test("documented subscription integrations do not create model-plan grants", async () => {
  const { registry } = await initial([copilot, codex]);
  const u = await upstream();
  for (const id of ["claude", "google-ai", "kimi", "zai-coding-plan", "minimax-m-plan"]) {
    expect(() => composeSubscription(u, registry, id, digest)).toThrow(
      ModelCatalogUnavailableError,
    );
    const definition =
      subscriptionManifest.subscriptions.find((item) => item.id === id) ?? missing();
    expect(subscriptionCoverage(registry, definition.products).status).toBe("unavailable");
    expect(definition.integration.routes.some((route) => route.support === "documented")).toBe(
      true,
    );
  }
  const chatgpt = composeSubscription(u, registry, "chatgpt", digest);
  expect(
    chatgpt.model_catalog.products.find((product) => product.id === "openai-codex")?.status,
  ).toBe("partial");
  expect(
    chatgpt.model_catalog.products.find((product) => product.id === "openai-chatgpt-plan-api")
      ?.status,
  ).toBe("unavailable");
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
  expect(() => composeSubscription(u, registry, "chatgpt", digest)).toThrow(
    ModelCatalogUnavailableError,
  );
});

test("integration metadata distinguishes native clients, token reuse, and subscription API keys", () => {
  const definition = (id: string) =>
    subscriptionManifest.subscriptions.find((item) => item.id === id) ?? missing();
  const claude = definition("claude");
  expect(
    claude.integration.routes.find((route) => route.kind === "cli")?.required_clients,
  ).toContain("claude-code");
  expect(claude.integration.routes.find((route) => route.kind === "direct-api")?.support).toBe(
    "not-supported",
  );
  expect(
    claude.integration.routes.find(
      (route) => route.kind === "sdk" && route.billing === "subscription",
    )?.support,
  ).toBe("not-supported");
  expect(
    claude.integration.routes.find(
      (route) => route.kind === "sdk" && route.billing === "usage-based",
    )?.support,
  ).toBe("documented");
  const google = definition("google-ai");
  expect(
    google.integration.routes.find((route) => route.id === "gemini-cli-subscription")?.protocols,
  ).toContain("acp-json-rpc-stdio");
  expect(
    google.integration.routes.find((route) => route.id === "gemini-cli-subscription")?.support,
  ).toBe("not-supported");
  expect(
    google.integration.routes.find((route) => route.id === "antigravity-cli-subscription")
      ?.execution,
  ).toBe("coding-agent");
  expect(google.integration.routes.find((route) => route.kind === "direct-api")?.support).toBe(
    "not-supported",
  );
  const kimi = definition("kimi");
  expect(
    kimi.integration.routes.find((route) => route.kind === "direct-api")?.auth_methods,
  ).toEqual(["api-key"]);
  expect(kimi.integration.routes.every((route) => route.automation === "restricted")).toBe(true);
  const minimax = definition("minimax-m-plan");
  expect(
    minimax.integration.routes.some(
      (route) =>
        route.kind === "direct-api" &&
        !route.required_clients.length &&
        route.third_party_use === "supported",
    ),
  ).toBe(true);
  const zai = definition("zai-coding-plan");
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
