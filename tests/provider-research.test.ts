import { expect, test } from "bun:test";
import { codex } from "../src/adapters/codex.ts";
import { composeProvider } from "../src/compose.ts";
import { composeConnections } from "../src/connections.ts";
import { classifyConnection, integrationRouteSchema } from "../src/integration-schema.ts";
import {
  composeProviderResearch,
  providerReview,
  providerReviewSchema,
} from "../src/provider-research.ts";
import { subscriptionManifest } from "../src/subscriptions.ts";
import { initial, upstream } from "./helpers.ts";

test("connection categories separate execution and billing from authentication and SDK transport", () => {
  expect(classifyConnection("direct-model", "subscription")).toBe("subscription");
  expect(classifyConnection("direct-model", "usage-based")).toBe("api-key");
  expect(classifyConnection("coding-agent", "subscription")).toBe("coding-agent");
  expect(classifyConnection("coding-agent", "usage-based")).toBe("coding-agent");
  expect(classifyConnection("unknown", "subscription")).toBe("unknown");
  const route = structuredClone(subscriptionManifest.subscriptions[0]?.integration.routes[0]);
  if (!route) throw new Error("Missing integration fixture");
  route.kind = "sdk";
  route.execution = "coding-agent";
  route.billing = "subscription";
  route.connection_kind = "subscription";
  expect(integrationRouteSchema.safeParse(route).success).toBe(false);
});

test("new upstream providers remain unreviewed and receive no inferred subscription", async () => {
  const u = await upstream();
  u.providers["new-provider"] = { id: "new-provider", models: {} };
  const digest = "a".repeat(64);
  const inventory = composeProviderResearch(u, digest);
  expect(inventory.counts.total).toBe(Object.keys(u.providers).length);
  const review = inventory.providers.find((item) => item.provider_id === "new-provider");
  expect(review?.review_status).toBe("unreviewed");
  expect(review?.reviewed_on).toBeNull();
  expect(review?.subscription_status).toBe("unknown");
  expect(review?.direct_api_key).toBe("unknown");
  expect(review?.subscription_ids).toEqual([]);
  const { registry } = await initial([codex]);
  const composed = composeProvider(u, registry, "new-provider", digest);
  expect(composed.subscription_research).toEqual(providerReview("new-provider"));
  expect(composed.models).toEqual({});
});

test("limited source access cannot establish direct credentials or subscription support", () => {
  const review = providerReview("future-unreviewed-provider");
  expect(providerReviewSchema.safeParse({ ...review, review_status: "reviewed" }).success).toBe(
    false,
  );
  expect(
    providerReviewSchema.safeParse({
      ...review,
      review_status: "limited",
      subscription_status: "documented",
    }).success,
  ).toBe(false);
  expect(
    providerReviewSchema.safeParse({
      ...review,
      review_status: "limited",
      direct_api_key: "documented",
    }).success,
  ).toBe(false);
});

test("subscription discovery excludes coding runtimes while agent routes retain both billing modes", async () => {
  const connections = composeConnections(await upstream(), "b".repeat(64));
  const direct = connections.routes.filter((route) => route.connection_kind === "subscription");
  expect(direct.length).toBeGreaterThan(0);
  expect(
    direct.every((route) => route.execution === "direct-model" && route.billing === "subscription"),
  ).toBe(true);
  expect(direct.some((route) => route.auth_methods.includes("api-key"))).toBe(true);
  const agents = connections.routes.filter((route) => route.connection_kind === "coding-agent");
  expect(agents.some((route) => route.billing === "subscription")).toBe(true);
  expect(
    agents.some(
      (route) => route.billing === "usage-based" && route.auth_methods.includes("api-key"),
    ),
  ).toBe(true);
  expect(agents.some((route) => route.kind === "sdk")).toBe(true);
  expect(connections.routes.every((route) => route.support === "documented")).toBe(true);
});
