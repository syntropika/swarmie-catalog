import { expect, test } from "bun:test";
import { codex } from "../src/adapters/codex.ts";
import { composeConnections } from "../src/connections.ts";
import {
  classifyProviderAccess,
  composedProviderAccessSchema,
  composeProviderAccess,
  filterProviderAccess,
  providerAccessReviewSchema,
} from "../src/provider-access.ts";
import { subscriptions } from "../src/subscriptions.ts";
import { initial, upstream } from "./helpers.ts";

const unknown = {
  provider_id: "unreviewed-provider",
  subscription_status: "unknown",
  api_key_status: "unknown",
  api_key_funding: ["unknown"],
  plans: [],
  policies: [],
  sources: [],
  evidence_mode: "unreviewed",
  summary: "No reviewed primary evidence.",
  limitations: ["Research is required."],
};

test("positive classification does not convert unknown or bounded absence into exclusive access", () => {
  expect(classifyProviderAccess("documented", "documented")).toBe("both");
  expect(classifyProviderAccess("unknown", "documented")).toBe("api-key");
  expect(classifyProviderAccess("not-found", "documented")).toBe("api-key");
  expect(classifyProviderAccess("documented", "unknown")).toBe("subscription");
  expect(classifyProviderAccess("unknown", "not-found")).toBe("unconfirmed");
});

test("policy findings require scoped source joins and actual retained-body hashes", () => {
  expect(providerAccessReviewSchema.safeParse(unknown).success).toBe(true);
  const source = {
    url: "https://example.com/terms",
    sha256: "a".repeat(64),
    capture_kind: "http-body",
    reviewed_on: "2026-11-20",
  };
  const review = {
    ...unknown,
    evidence_mode: "rechecked",
    sources: [source],
    policies: [
      {
        scope: "Personal coding plan",
        topic: "third-party-use",
        status: "restricted",
        summary: "Approved coding clients only.",
        source_urls: [source.url],
      },
    ],
  };
  expect(providerAccessReviewSchema.safeParse(review).success).toBe(true);
  expect(providerAccessReviewSchema.safeParse({ ...review, sources: [] }).success).toBe(false);
  expect(
    providerAccessReviewSchema.safeParse({ ...review, sources: [{ ...source, sha256: null }] })
      .success,
  ).toBe(false);
  expect(
    providerAccessReviewSchema.safeParse({
      ...review,
      sources: [{ ...source, sha256: null, capture_kind: "retained-reference" }],
    }).success,
  ).toBe(true);
  expect(
    providerAccessReviewSchema.safeParse({ ...unknown, api_key_status: "documented" }).success,
  ).toBe(false);
});

test("current inventory composition preserves scopes and leaves new provider facts unknown", async () => {
  const input = await upstream();
  input.providers.future = { id: "future", models: {} };
  const result = composeProviderAccess(input, "a".repeat(64));
  expect(result.role).toBe("research-only");
  expect(result.counts.total).toBe(Object.keys(input.providers).length);
  const future = result.providers.find((provider) => provider.provider_id === "future");
  expect(future).toMatchObject({
    category: "unconfirmed",
    evidence_mode: "unreviewed",
    sources: [],
    plans: [],
    policies: [],
  });
  const both = filterProviderAccess(result, (provider) => provider.category === "both");
  expect(both.counts.total).toBe(both.counts.both);
  expect(
    both.providers.every(
      (provider) =>
        provider.subscription_status === "documented" && provider.api_key_status === "documented",
    ),
  ).toBe(true);
  expect(
    composedProviderAccessSchema.safeParse({
      ...result,
      counts: { ...result.counts, total: 100000 },
    }).success,
  ).toBe(false);
});

test("current DevPass and Antigravity restrictions do not become custom application permission", async () => {
  const { registry } = await initial([codex]);
  const catalog = composeConnections(await upstream(), "a".repeat(64), registry);
  expect(
    catalog.connections.some(
      (connection) =>
        connection.id === "llmgateway-devpass/devpass-api-key" ||
        connection.id === "llmgateway-devpass/devpass-key",
    ),
  ).toBe(false);
  const devpass = subscriptions.find((subscription) => subscription.id === "llmgateway-devpass");
  expect(devpass?.integration.routes.find((route) => route.id === "devpass-api-key")).toMatchObject(
    { support: "not-supported", third_party_use: "restricted", automation: "restricted" },
  );
  const google = catalog.connections.find(
    (connection) => connection.id === "google-ai/antigravity-cli-subscription",
  );
  expect(google).toMatchObject({
    support: "documented",
    third_party_use: "restricted",
    automation: "restricted",
  });
  expect(google?.constraints.some((condition) => condition.includes("scripting and CI"))).toBe(
    true,
  );
  expect(google?.constraints.some((condition) => condition.includes("wrapping agy"))).toBe(true);
});
