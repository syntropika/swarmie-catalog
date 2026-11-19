import { z } from "zod";
import data from "../data/provider-research.json" with { type: "json" };
import type { Upstream } from "./schema.ts";

const text = z.string().min(1);
export const providerReviewSchema = z
  .object({
    provider_id: text,
    reviewed_on: z.iso.date().nullable(),
    review_status: z.enum(["reviewed", "limited", "unreviewed"]),
    subscription_status: z.enum(["documented", "not-found", "unknown"]),
    billing_models: z
      .array(
        z.enum([
          "subscription",
          "pay-as-you-go",
          "credits",
          "free",
          "byok",
          "self-hosted",
          "unknown",
        ]),
      )
      .min(1),
    direct_api_key: z.enum(["documented", "unknown"]),
    subscription_names: z.array(text),
    subscription_ids: z.array(text),
    summary: text,
    sources: z.array(
      z
        .object({
          url: z.url(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          capture_kind: z.enum(["http-body", "web-extract"]),
          summary: text,
        })
        .strict(),
    ),
    limitations: z.array(text),
  })
  .strict()
  .superRefine((review, ctx) => {
    if (review.review_status !== "unreviewed" && review.reviewed_on === null)
      ctx.addIssue({ code: "custom", message: "A provider review requires its review date" });
    if (review.review_status === "reviewed" && !review.sources.length)
      ctx.addIssue({
        code: "custom",
        message: "A reviewed provider requires primary source evidence",
      });
    if (
      !review.sources.length &&
      (review.subscription_status !== "unknown" || review.direct_api_key !== "unknown")
    )
      ctx.addIssue({ code: "custom", message: "Missing sources cannot establish access" });
    if (
      review.review_status === "unreviewed" &&
      (review.subscription_status !== "unknown" || review.direct_api_key !== "unknown")
    )
      ctx.addIssue({ code: "custom", message: "An unreviewed provider cannot establish access" });
  });
export const providerResearchSchema = z
  .object({
    schema_version: z.literal(1),
    reviewed_on: z.iso.date(),
    upstream_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    providers: z.array(providerReviewSchema),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const ids = new Set<string>();
    for (const review of manifest.providers) {
      if (ids.has(review.provider_id))
        ctx.addIssue({
          code: "custom",
          message: `Duplicate provider review: ${review.provider_id}`,
        });
      ids.add(review.provider_id);
    }
  });
export const composedProviderResearchSchema = providerResearchSchema.safeExtend({
  current_upstream_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  counts: z
    .object({
      total: z.number().int().nonnegative(),
      reviewed: z.number().int().nonnegative(),
      limited: z.number().int().nonnegative(),
      unreviewed: z.number().int().nonnegative(),
    })
    .strict(),
});
export type ProviderReview = z.infer<typeof providerReviewSchema>;
export const providerResearch = providerResearchSchema.parse(data);
const reviews = new Map(providerResearch.providers.map((review) => [review.provider_id, review]));

/** Preserve unknown research status when models.dev adds a provider. */
export function providerReview(providerId: string): ProviderReview {
  return (
    reviews.get(providerId) ?? {
      provider_id: providerId,
      reviewed_on: null,
      review_status: "unreviewed",
      subscription_status: "unknown",
      billing_models: ["unknown"],
      direct_api_key: "unknown",
      subscription_names: [],
      subscription_ids: [],
      summary: "No provider review exists for this models.dev identifier.",
      sources: [],
      limitations: ["This provider requires a primary source review."],
    }
  );
}

export function composeProviderResearch(upstream: Upstream, upstreamSha256: string) {
  const providers = Object.keys(upstream.providers).sort().map(providerReview);
  return composedProviderResearchSchema.parse({
    ...providerResearch,
    current_upstream_sha256: upstreamSha256,
    counts: {
      total: providers.length,
      reviewed: providers.filter((item) => item.review_status === "reviewed").length,
      limited: providers.filter((item) => item.review_status === "limited").length,
      unreviewed: providers.filter((item) => item.review_status === "unreviewed").length,
    },
    providers,
  });
}
