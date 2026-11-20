import { z } from "zod";
import data from "../data/provider-access.json" with { type: "json" };
import type { Upstream } from "./schema.ts";

const text = z.string().min(1);
const finding = z.enum(["documented", "not-found", "unknown"]);
const category = z.enum(["both", "subscription", "api-key", "unconfirmed"]);

/** Classify positive evidence without turning missing evidence into a prohibition. */
export function classifyProviderAccess(
  subscription: z.infer<typeof finding>,
  apiKey: z.infer<typeof finding>,
): z.infer<typeof category> {
  if (subscription === "documented" && apiKey === "documented") return "both";
  if (subscription === "documented") return "subscription";
  return apiKey === "documented" ? "api-key" : "unconfirmed";
}

export const providerAccessReviewSchema = z
  .object({
    provider_id: text,
    subscription_status: finding,
    api_key_status: finding,
    api_key_funding: z.array(z.enum(["subscription", "usage-based", "byok", "unknown"])).min(1),
    plans: z.array(
      z
        .object({
          name: text,
          scope: z.enum([
            "direct-model",
            "coding-agent",
            "chat-app",
            "platform",
            "compute",
            "unknown",
          ]),
          authentication: z.array(z.enum(["api-key", "oauth", "account-login", "oidc", "unknown"])),
          third_party_use: z.enum(["supported", "restricted", "prohibited", "unknown"]),
          required_clients: z.array(text),
          constraints: z.array(text),
          source_urls: z.array(z.url()).min(1),
        })
        .strict(),
    ),
    policies: z.array(
      z
        .object({
          scope: text,
          topic: z.enum([
            "third-party-use",
            "automation",
            "credential-use",
            "model-access",
            "billing",
            "privacy",
            "region",
            "quotas",
            "client-requirement",
            "other",
          ]),
          status: z.enum(["permitted", "restricted", "prohibited", "documented", "unknown"]),
          summary: text,
          source_urls: z.array(z.url()),
        })
        .strict(),
    ),
    summary: text,
    limitations: z.array(text),
    sources: z.array(
      z
        .object({
          url: z.url(),
          sha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullable(),
          capture_kind: z.enum(["http-body", "web-extract", "retained-reference"]),
          reviewed_on: z.iso.date(),
        })
        .strict(),
    ),
    evidence_mode: z.enum(["rechecked", "retained-evidence", "mixed", "unreviewed"]),
  })
  .strict()
  .superRefine((review, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const urls = new Set(review.sources.map((source) => source.url));
    if (
      (review.subscription_status === "documented" || review.api_key_status === "documented") &&
      !urls.size
    )
      fail("Positive access findings require source evidence");
    if (
      review.evidence_mode === "unreviewed" &&
      (review.subscription_status !== "unknown" ||
        review.api_key_status !== "unknown" ||
        review.plans.length ||
        review.policies.length ||
        review.sources.length)
    )
      fail("Unreviewed providers cannot contain access or policy findings");
    for (const source of review.sources) {
      if (source.capture_kind !== "retained-reference" && source.sha256 === null)
        fail("Retained HTTP bodies and extracts require their actual digest");
    }
    for (const plan of review.plans) {
      if (plan.source_urls.some((url) => !urls.has(url))) fail("Missing plan source");
    }
    for (const policy of review.policies) {
      if (policy.status !== "unknown" && !policy.source_urls.length)
        fail("A policy finding requires primary source evidence");
      if (policy.source_urls.some((url) => !urls.has(url))) fail("Missing policy source");
    }
  });

export const providerAccessSchema = z
  .object({
    schema_version: z.literal(1),
    reviewed_on: z.iso.date(),
    upstream_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    providers: z.array(providerAccessReviewSchema),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const ids = manifest.providers.map((review) => review.provider_id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Duplicate provider access review" });
  });

const classifiedReviewSchema = providerAccessReviewSchema.safeExtend({ category });
type ClassifiedReview = z.infer<typeof classifiedReviewSchema>;
const count = z.number().int().nonnegative();
export const composedProviderAccessSchema = z
  .object({
    schema_version: z.literal(1),
    reviewed_on: z.iso.date(),
    upstream_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    current_upstream_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    role: z.literal("research-only"),
    providers: z.array(classifiedReviewSchema),
    counts: z
      .object({
        total: count,
        both: count,
        subscription: count,
        "api-key": count,
        unconfirmed: count,
      })
      .strict(),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    const ids = catalog.providers.map((provider) => provider.provider_id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Duplicate classified provider" });
    if (
      catalog.providers.some(
        (provider) =>
          provider.category !==
          classifyProviderAccess(provider.subscription_status, provider.api_key_status),
      )
    )
      ctx.addIssue({ code: "custom", message: "Classification does not match source findings" });
    const expected = accessCounts(catalog.providers);
    for (const key of ["total", "both", "subscription", "api-key", "unconfirmed"] as const) {
      if (catalog.counts[key] !== expected[key])
        ctx.addIssue({ code: "custom", message: `Incorrect access count: ${key}` });
    }
  });

function accessCounts(providers: ClassifiedReview[]) {
  return {
    total: providers.length,
    both: providers.filter((provider) => provider.category === "both").length,
    subscription: providers.filter((provider) => provider.category === "subscription").length,
    "api-key": providers.filter((provider) => provider.category === "api-key").length,
    unconfirmed: providers.filter((provider) => provider.category === "unconfirmed").length,
  };
}

/** Filter a research response without transferring plan-specific policy to other routes. */
export function filterProviderAccess(
  catalog: z.infer<typeof composedProviderAccessSchema>,
  include: (provider: ClassifiedReview) => boolean,
) {
  const providers = catalog.providers.filter(include);
  return composedProviderAccessSchema.parse({
    ...catalog,
    providers,
    counts: accessCounts(providers),
  });
}

export const providerAccess = providerAccessSchema.parse(data);
const reviews = new Map(providerAccess.providers.map((review) => [review.provider_id, review]));

/** Preserve policy scope and unknowns. Research never grants integration or model authority. */
export function composeProviderAccess(upstream: Upstream, upstreamSha256: string) {
  const providers = Object.keys(upstream.providers)
    .sort()
    .map((id) => {
      const review =
        reviews.get(id) ??
        providerAccessReviewSchema.parse({
          provider_id: id,
          subscription_status: "unknown",
          api_key_status: "unknown",
          api_key_funding: ["unknown"],
          plans: [],
          policies: [],
          sources: [],
          evidence_mode: "unreviewed",
          summary: "No provider access and subscription policy review exists for this identifier.",
          limitations: ["Primary source research is required."],
        });
      return {
        ...review,
        category: classifyProviderAccess(review.subscription_status, review.api_key_status),
      };
    });
  return composedProviderAccessSchema.parse({
    ...providerAccess,
    current_upstream_sha256: upstreamSha256,
    role: "research-only",
    providers,
    counts: accessCounts(providers),
  });
}
