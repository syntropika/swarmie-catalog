import { z } from "zod";
import { subscriptionDefinitionSchema } from "./integration-schema.ts";
import { providerReviewSchema } from "./provider-research.ts";

const text = z.string().min(1);
export const availabilitySchema = z.enum(["available", "unavailable", "unknown"]);
export type Availability = z.infer<typeof availabilitySchema>;
export const evidenceSchema = z.object({ source: text, locator: text }).strict();
export const sourceSchema = z
  .object({
    id: text,
    url: z.url(),
    revision: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    modified_at: z.iso.datetime().nullable(),
  })
  .strict();
export type Source = z.infer<typeof sourceSchema>;
export const claimSchema = z
  .object({
    product: text,
    provider: text,
    source_model: text,
    request_model_id: text.nullable(),
    offering_provider: text.nullable(),
    route_ids: z.array(text),
    request_api: z.record(text, z.url()),
    conditions: z.record(text, z.json()),
    model_id: text.nullable(),
    channel: z.enum(["subscription", "api"]),
    plan: text.nullable(),
    surface: text.nullable(),
    variant: text.nullable(),
    minimum_client_version: text.nullable(),
    status: availabilitySchema,
    reason: text,
    evidence: z.array(evidenceSchema).min(1),
  })
  .strict();
export type Claim = z.infer<typeof claimSchema>;
export type ExtractedClaim = Omit<Claim, "model_id"> & { canonical_hint?: string };
export const providerSchema = z
  .object({
    id: text,
    state: z.enum(["current", "stale"]),
    error: text.nullable(),
    source_updated_at: z.iso.datetime().nullable(),
    sources: z.array(sourceSchema).min(1),
    claims: z.array(claimSchema).min(1),
  })
  .strict();
export type ProviderData = z.infer<typeof providerSchema>;
export const registrySchema = z
  .object({
    schema_version: z.literal(2),
    upstream: z.literal("https://models.dev/catalog.json?type=all"),
    providers: z.array(providerSchema),
  })
  .strict();
export type Registry = z.infer<typeof registrySchema>;

const metadata = z.object({ id: text, name: text }).passthrough();
export const upstreamModelSchema = metadata.extend({ canonical_model_id: text.optional() });
export const upstreamProviderSchema = z
  .object({
    id: text,
    models: z.record(text, upstreamModelSchema),
  })
  .passthrough();
export const upstreamSchema = z
  .object({
    models: z.record(text, metadata),
    providers: z.record(text, upstreamProviderSchema),
  })
  .passthrough()
  .superRefine((catalog, ctx) => {
    if (!Object.keys(catalog.models).length || !Object.keys(catalog.providers).length) {
      ctx.addIssue({ code: "custom", message: "Empty upstream catalog" });
    }
    for (const [key, model] of Object.entries(catalog.models)) {
      if (key !== model.id)
        ctx.addIssue({ code: "custom", message: `Model identity mismatch: ${key}` });
    }
    for (const [key, provider] of Object.entries(catalog.providers)) {
      if (key !== provider.id)
        ctx.addIssue({ code: "custom", message: `Provider identity mismatch: ${key}` });
      for (const [id, model] of Object.entries(provider.models)) {
        if (id !== model.id)
          ctx.addIssue({ code: "custom", message: `Offering identity mismatch: ${id}` });
      }
    }
  });
export type Upstream = z.infer<typeof upstreamSchema>;
export const aliasesSchema = z.record(
  text,
  z
    .object({
      model_id: text,
      variant: text.nullable(),
      reason: text,
      source: z.url(),
    })
    .strict(),
);
export type Aliases = z.infer<typeof aliasesSchema>;

export const subscriptionOfferSchema = claimSchema.omit({ plan: true }).extend({
  subscription: text,
  plans: z.array(text.nullable()).min(1),
  state: z.enum(["current", "stale"]),
  source_updated_at: z.iso.datetime().nullable(),
  error: text.nullable(),
});
export type SubscriptionOffer = z.infer<typeof subscriptionOfferSchema>;
const enrichedModelSchema = upstreamModelSchema.extend({
  subscription_access: z.array(subscriptionOfferSchema),
});
const subscriptionCatalogSchema = z
  .object({
    schema_version: z.literal(4),
    role: z.literal("reference-only"),
    model_selection: z.literal("connection-discovery-required"),
    connections: z.literal("connections.json"),
    upstream: z
      .object({
        url: z.literal("https://models.dev/catalog.json?type=all"),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    sources: z.array(sourceSchema),
  })
  .strict();
export const composedProviderSchema = upstreamProviderSchema.extend({
  models: z.record(text, enrichedModelSchema),
  subscription_catalog: subscriptionCatalogSchema,
  subscription_research: providerReviewSchema,
});
export type ComposedProvider = z.infer<typeof composedProviderSchema>;
export const composedSubscriptionSchema = subscriptionDefinitionSchema
  .safeExtend({
    model_catalog: z
      .object({
        status: z.enum(["partial", "unavailable"]),
        products: z
          .array(
            z
              .object({
                id: text,
                status: z.enum(["partial", "unavailable"]),
                state: z.enum(["current", "stale"]).nullable(),
                native_models: z.number().int().nonnegative(),
                available_models: z.number().int().nonnegative(),
                unresolved_models: z.number().int().nonnegative(),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    models: z.record(text, enrichedModelSchema),
    subscription_catalog: subscriptionCatalogSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!Object.keys(value.models).length)
      ctx.addIssue({
        code: "custom",
        message: "A published subscription model catalog must not be empty",
      });
  });
export type ComposedSubscription = z.infer<typeof composedSubscriptionSchema>;
