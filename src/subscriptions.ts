import data from "../data/subscriptions.json" with { type: "json" };
import { subscriptionManifestSchema } from "./integration-schema.ts";
import type { ComposedSubscription, Registry } from "./schema.ts";

export const subscriptionManifest = subscriptionManifestSchema.parse(data);
export const subscriptions = subscriptionManifest.subscriptions;

/** Resolve the subscription namespace without changing the source product or plan tokens. */
export function subscriptionForProduct(product: string): string {
  const definition = subscriptions.find((item) => item.products.includes(product));
  if (!definition) throw new Error(`Unknown subscription product: ${product}`);
  return definition.id;
}

/** Report source coverage independently of documented integration support. */
export function subscriptionCoverage(
  registry: Registry,
  products: string[],
): ComposedSubscription["model_catalog"] {
  const coverage = products.map((id) => {
    const owner = registry.providers.find(
      (item) => item.id === id && item.claims.some((claim) => claim.channel === "subscription"),
    );
    return {
      id,
      status: owner ? ("partial" as const) : ("unavailable" as const),
      state: owner?.state ?? null,
      native_models: new Set(
        owner?.claims
          .filter((claim) => claim.channel === "subscription")
          .map((claim) => claim.source_model),
      ).size,
      available_models: new Set(
        owner?.claims
          .filter((claim) => claim.channel === "subscription" && claim.status === "available")
          .map((claim) => claim.source_model),
      ).size,
      unresolved_models: new Set(
        owner?.claims
          .filter((claim) => claim.channel === "subscription" && claim.model_id === null)
          .map((claim) => claim.source_model),
      ).size,
    };
  });
  return {
    status: coverage.some((item) => item.status === "partial") ? "partial" : "unavailable",
    products: coverage,
  };
}
