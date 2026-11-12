import { z } from "zod";

const text = z.string().min(1);
export const availabilitySchema = z.enum(["available", "unavailable", "unknown"]);
export type Availability = z.infer<typeof availabilitySchema>;
export const evidenceSchema = z.object({ source: text, locator: text }).strict();
export const sourceSchema = z
  .object({
    id: text,
    url: z.url(),
    revision: z.string().regex(/^[a-f0-9]{40}$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    modified_at: z.iso.datetime(),
  })
  .strict();
export type Source = z.infer<typeof sourceSchema>;
export const claimSchema = z
  .object({
    product: text,
    provider: text,
    source_model: text,
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
export type ExtractedClaim = Omit<Claim, "model_id">;
export const providerSchema = z
  .object({
    id: text,
    state: z.enum(["current", "stale"]),
    error: text.nullable(),
    source_updated_at: z.iso.datetime(),
    sources: z.array(sourceSchema).min(1),
    claims: z.array(claimSchema).min(1),
  })
  .strict();
export type ProviderData = z.infer<typeof providerSchema>;
export const registrySchema = z
  .object({
    schema_version: z.literal(1),
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
  source_updated_at: z.iso.datetime(),
  error: text.nullable(),
});
export type SubscriptionOffer = z.infer<typeof subscriptionOfferSchema>;
const enrichedModelSchema = upstreamModelSchema.extend({
  subscription_access: z.array(subscriptionOfferSchema),
});
const subscriptionCatalogSchema = z
  .object({
    schema_version: z.literal(2),
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
});
export type ComposedProvider = z.infer<typeof composedProviderSchema>;
export const composedSubscriptionSchema = z
  .object({
    id: text,
    name: text,
    products: z.array(text).min(1),
    models: z.record(text, enrichedModelSchema),
    subscription_catalog: subscriptionCatalogSchema,
  })
  .strict();
export type ComposedSubscription = z.infer<typeof composedSubscriptionSchema>;
