import type { Registry } from "./schema.ts";
import { compare } from "./stable.ts";
import { subscriptionCoverage, subscriptions } from "./subscriptions.ts";

export function coverage(registry: Registry) {
  return {
    providers: registry.providers.map((provider) => ({
      id: provider.id,
      state: provider.state,
      plans: [
        ...new Set(provider.claims.flatMap((claim) => (claim.plan === null ? [] : [claim.plan]))),
      ].sort(compare),
      claims: provider.claims.length,
      statuses: Object.fromEntries(
        ["available", "unavailable", "unknown"].map((status) => [
          status,
          provider.claims.filter((claim) => claim.status === status).length,
        ]),
      ),
      unresolved: [
        ...new Set(
          provider.claims
            .filter((claim) => claim.model_id === null)
            .map((claim) => claim.source_model),
        ),
      ].sort(compare),
    })),
    subscriptions: subscriptions.map((definition) => ({
      id: definition.id,
      ...subscriptionCoverage(registry, definition.products),
    })),
    gaps: subscriptions.flatMap((definition) => {
      const source = subscriptionCoverage(registry, definition.products);
      const available = source.products.reduce((sum, p) => sum + p.available_models, 0);
      return available
        ? []
        : [
            {
              subscription: definition.id,
              products: definition.products,
              reason:
                source.status === "unavailable"
                  ? "no-published-model-source"
                  : "no-available-source-models",
              sources: definition.integration.sources.map((source) => source.url),
            },
          ];
    }),
  };
}
