import { z } from "zod";
import { integrationRouteSchema } from "./integration-schema.ts";
import { composeProviderResearch } from "./provider-research.ts";
import type { Upstream } from "./schema.ts";
import { subscriptions } from "./subscriptions.ts";

export const connectionsSchema = z
  .object({
    schema_version: z.literal(1),
    routes: z.array(
      integrationRouteSchema.safeExtend({
        subscription_id: z.string().min(1),
        subscription_path: z.string().min(1),
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
export function composeConnections(upstream: Upstream, upstreamSha256: string) {
  const research = composeProviderResearch(upstream, upstreamSha256);
  return connectionsSchema.parse({
    schema_version: 1,
    routes: subscriptions.flatMap((subscription) =>
      subscription.integration.routes
        .filter((route) => route.support === "documented")
        .map((route) => ({
          subscription_id: subscription.id,
          subscription_path: `subscriptions/${encodeURIComponent(subscription.id)}.json`,
          ...route,
        })),
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
