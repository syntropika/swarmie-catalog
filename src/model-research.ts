import { z } from "zod";
import data from "../data/model-research.json" with { type: "json" };
import type { Upstream } from "./schema.ts";

const text = z.string().min(1);
const profileSchema = z
  .object({
    subscription_id: text,
    discovery: z.enum([
      "public-structured",
      "public-documentation",
      "authenticated-only",
      "insufficient-public-evidence",
    ]),
    plan_names: z.array(text),
    source_urls: z.array(z.url()),
    parser: z
      .object({
        format: z.enum(["json", "markdown", "html-table", "github-source", "none"]),
        source_url: z.url().nullable(),
        model_path: text.nullable(),
        id_field: text.nullable(),
        plan_path: text.nullable(),
        strategy: text,
        plan_rule: text,
        limitations: z.array(text),
      })
      .strict(),
    limitations: z.array(text),
  })
  .strict();
const reviewSchema = z
  .object({
    provider_id: text,
    subscription_status: z.enum(["documented", "not-found", "unknown"]),
    summary: text,
    sources: z.array(
      z
        .object({
          url: z.url(),
          purpose: text,
          sha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullable(),
        })
        .strict(),
    ),
    profiles: z.array(profileSchema),
    limitations: z.array(text),
  })
  .strict();
export const modelResearchSchema = z
  .object({
    schema_version: z.literal(1),
    reviewed_on: z.iso.date(),
    upstream_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    providers: z.array(reviewSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.providers.map((p) => p.provider_id)).size !== value.providers.length)
      ctx.addIssue({ code: "custom", message: "Duplicate model source research provider" });
  });
export const modelResearch = modelResearchSchema.parse(data);
/** Describe public discovery evidence independently of executable adapters and account access. */
export function composeModelResearch(upstream: Upstream) {
  const reviews = new Map(modelResearch.providers.map((p) => [p.provider_id, p]));
  return modelResearchSchema.parse({
    ...modelResearch,
    providers: Object.keys(upstream.providers)
      .sort()
      .map(
        (id) =>
          reviews.get(id) ?? {
            provider_id: id,
            subscription_status: "unknown",
            summary: "No subscription model source review exists for this provider.",
            sources: [],
            profiles: [],
            limitations: ["Primary source research is required."],
          },
      ),
  });
}
