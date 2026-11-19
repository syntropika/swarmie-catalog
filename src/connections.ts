import { z } from "zod";
import { integrationRouteSchema } from "./integration-schema.ts";
import { composeProviderResearch } from "./provider-research.ts";
import type { Registry, Upstream } from "./schema.ts";
import { subscriptions } from "./subscriptions.ts";

export const connectionsSchema = z
  .object({
    schema_version: z.literal(2),
    routes: z.array(
      integrationRouteSchema.safeExtend({
        subscription_id: z.string().min(1),
        subscription_path: z.string().min(1).nullable(),
        model_catalog: z
          .object({
            status: z.enum(["ready", "unavailable", "not-applicable"]),
            native_models: z.number().int().nonnegative(),
            available_models: z.number().int().nonnegative(),
            reason: z.string().min(1),
          })
          .strict(),
      }),
    ),
    provider_api_keys: z.array(
      z
        .object({
          provider_id: z.string().min(1),
          provider_path: z.string().min(1),
          billing_models: z.array(z.string().min(1)).min(1),
          review_status: z.enum(["reviewed", "limited"]),
        })
        .strict(),
    ),
    research_coverage: z
      .object({
        total: z.number().int().nonnegative(),
        reviewed: z.number().int().nonnegative(),
        limited: z.number().int().nonnegative(),
        unreviewed: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

/** Discover documented connection routes without granting account or application authority. */
export function composeConnections(upstream: Upstream, upstreamSha256: string, registry: Registry) {
  const research = composeProviderResearch(upstream, upstreamSha256);
  return connectionsSchema.parse({
    schema_version: 2,
    routes: subscriptions.flatMap((subscription) =>
      subscription.integration.routes
        .filter((route) => route.support === "documented")
        .map((route) => {
          const owners = registry.providers.filter((owner) =>
            subscription.products.includes(owner.id),
          );
          const claims = owners.flatMap((owner) =>
            owner.claims
              .filter(
                (claim) => claim.channel === "subscription" && claim.route_ids.includes(route.id),
              )
              .map((claim) => ({ claim, state: owner.state })),
          );
          const available = claims.filter(
            ({ claim, state }) =>
              state === "current" &&
              claim.status === "available" &&
              claim.request_model_id !== null &&
              claim.plan !== null,
          );
          const subscriptionBilling = route.billing === "subscription";
          const hasCatalog = owners.some((owner) =>
            owner.claims.some((claim) => claim.channel === "subscription"),
          );
          return {
            subscription_id: subscription.id,
            subscription_path: hasCatalog
              ? `subscriptions/${encodeURIComponent(subscription.id)}.json`
              : null,
            ...route,
            model_catalog: {
              status: !subscriptionBilling
                ? "not-applicable"
                : available.length
                  ? "ready"
                  : "unavailable",
              native_models: new Set(claims.map(({ claim }) => claim.source_model)).size,
              available_models: new Set(available.map(({ claim }) => claim.source_model)).size,
              reason: !subscriptionBilling
                ? "separate-api-key-billing"
                : available.length
                  ? "current-source-backed-route-membership"
                  : "no-current-qualified-route-models",
            },
          };
        }),
    ),
    provider_api_keys: research.providers
      .filter(
        (review) =>
          review.direct_api_key === "documented" &&
          (review.billing_models.includes("pay-as-you-go") ||
            review.billing_models.includes("byok") ||
            (review.billing_models.includes("credits") &&
              !review.billing_models.includes("subscription"))),
      )
      .map((review) => ({
        provider_id: review.provider_id,
        provider_path: `providers/${encodeURIComponent(review.provider_id)}.json`,
        billing_models: review.billing_models,
        review_status: review.review_status,
      })),
    research_coverage: research.counts,
  });
}
