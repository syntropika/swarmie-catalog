import { expect, test } from "bun:test";
import { codex } from "../src/adapters/codex.ts";
import { composeProvider } from "../src/compose.ts";
import { composeConnections } from "../src/connections.ts";
import { integrationRouteSchema } from "../src/integration-schema.ts";
import {
  composeProviderResearch,
  providerReview,
  providerReviewSchema,
} from "../src/provider-research.ts";
import { subscriptionManifest } from "../src/subscriptions.ts";
import { initial, upstream } from "./helpers.ts";

test("SDK transport does not determine execution or billing", () => {
  const route = structuredClone(subscriptionManifest.subscriptions[0]?.integration.routes[0]);
  if (!route) throw new Error("Missing integration fixture");
  route.kind = "sdk";
  route.execution = "coding-agent";
  route.billing = "subscription";
  route.required_clients = ["approved-sdk"];
  expect(integrationRouteSchema.safeParse(route).success).toBe(true);
  route.required_clients = [];
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

test("connection discovery keeps execution, billing and authentication independent", async () => {
  const { registry } = await initial([codex]);
  const catalog = composeConnections(await upstream(), "b".repeat(64), registry);
  const direct = catalog.connections.filter(
    (connection) =>
      connection.execution === "direct-model" && connection.billing.kind === "subscription",
  );
  expect(direct.length).toBeGreaterThan(0);
  expect(direct.some((connection) => connection.authentication.methods.includes("api-key"))).toBe(
    true,
  );
  const agents = catalog.connections.filter(
    (connection) => connection.execution === "coding-agent",
  );
  expect(agents.some((connection) => connection.billing.kind === "subscription")).toBe(true);
  expect(
    agents.some(
      (connection) =>
        connection.billing.kind === "usage-based" &&
        connection.authentication.methods.includes("api-key"),
    ),
  ).toBe(true);
  expect(agents.some((connection) => connection.transport.kind === "sdk")).toBe(true);
  expect(catalog.connections.every((connection) => connection.support === "documented")).toBe(true);
  expect(
    catalog.connections.some((connection) => connection.reference_catalog.status === "documented"),
  ).toBe(true);
  expect(direct.every((connection) => connection.reference_catalog.status === "unavailable")).toBe(
    true,
  );
  expect(
    catalog.connections.every(
      (connection) =>
        connection.model_discovery.requirement === "required" &&
        !connection.model_discovery.static_fallback,
    ),
  ).toBe(true);
});
