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
      status: owner ? ("partial" as const) : ("unknown" as const),
      state: owner?.state ?? null,
    };
  });
  return {
    status: coverage.some((item) => item.status === "partial") ? "partial" : "unknown",
    products: coverage,
  };
}
