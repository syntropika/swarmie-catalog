import { providerReview } from "./provider-research.ts";
import { query } from "./query.ts";
import {
  type ComposedProvider,
  type ComposedSubscription,
  composedProviderSchema,
  composedSubscriptionSchema,
  type Registry,
  type SubscriptionOffer,
  type Upstream,
} from "./schema.ts";
import { compare, stable } from "./stable.ts";
import { subscriptionCoverage, subscriptionForProduct, subscriptions } from "./subscriptions.ts";

function accessByModel(registry: Registry, upstream: Upstream): Map<string, SubscriptionOffer[]> {
  const owners = new Map(registry.providers.map((item) => [item.id, item]));
  const groups = new Map<string, SubscriptionOffer>();
  const declarations = query(registry, {
    channel: "subscription",
    includeStale: true,
    includeUnresolved: true,
  });
  for (const { plan, evidence, ...claim } of declarations) {
    const owner = owners.get(claim.product);
    if (!owner) throw new Error(`Missing declaration owner: ${claim.product}`);
    const conditions = {
      ...claim,
      model_id: claim.model_id && upstream.models[claim.model_id] ? claim.model_id : null,
      subscription: subscriptionForProduct(claim.product),
      state: owner.state,
      error: owner.error,
      source_updated_at: owner.source_updated_at,
    };
    const key = stable(conditions);
    let group = groups.get(key);
    if (!group) {
      group = { ...conditions, plans: [], evidence: [] };
      groups.set(key, group);
    }
    if (!group.plans.includes(plan)) group.plans.push(plan);
    for (const item of evidence) {
      if (
        !group.evidence.some(
          (entry) => entry.source === item.source && entry.locator === item.locator,
        )
      )
        group.evidence.push(item);
    }
  }
  const models = new Map<string, SubscriptionOffer[]>();
  for (const [, group] of [...groups.entries()].sort(([a], [b]) => compare(a, b))) {
    const modelKey = group.model_id ?? `${group.product}/${encodeURIComponent(group.source_model)}`;
    group.plans.sort((a, b) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : compare(a, b)));
    group.evidence.sort((a, b) => compare(stable(a), stable(b)));
    const entries = models.get(modelKey) ?? [];
    entries.push(group);
    models.set(modelKey, entries);
  }
  return models;
}

function catalogMetadata(registry: Registry, upstreamSha256: string, entries: SubscriptionOffer[]) {
  const requiredSources = new Set(
    entries.flatMap((entry) => entry.evidence.map((item) => item.source)),
  );
  return {
    schema_version: 3 as const,
    upstream: { url: registry.upstream, sha256: upstreamSha256 },
    sources: registry.providers
      .flatMap((item) => item.sources)
      .filter((source) => requiredSources.has(source.id))
      .sort((a, b) => compare(a.id, b.id)),
  };
}

/** Preserve upstream offerings and join source declarations through exact canonical identities. */
function providerView(
  upstream: Upstream,
  registry: Registry,
  providerId: string,
  upstreamSha256: string,
  access: Map<string, SubscriptionOffer[]>,
): ComposedProvider {
  const provider = upstream.providers[providerId];
  if (!provider) throw new Error(`Unknown upstream provider: ${providerId}`);
  if ("subscription_catalog" in provider || "subscription_research" in provider)
    throw new Error("Upstream enrichment field collision");
  const models = Object.fromEntries(
    Object.entries(provider.models)
      .sort(([a], [b]) => compare(a, b))
      .map(([id, model]) => {
        if ("subscription_access" in model)
          throw new Error("Upstream model enrichment field collision");
        const direct = `${providerId}/${id}`;
        const candidate = model.canonical_model_id ?? (upstream.models[direct] ? direct : null);
        const canonical = candidate !== null && upstream.models[candidate] ? candidate : null;
        return [
          id,
          {
            ...model,
            subscription_access: canonical === null ? [] : (access.get(canonical) ?? []),
          },
        ];
      }),
  );
  return composedProviderSchema.parse({
    ...provider,
    subscription_research: providerReview(providerId),
    models,
    subscription_catalog: catalogMetadata(
      registry,
      upstreamSha256,
      Object.values(models).flatMap((model) => model.subscription_access),
    ),
  });
}

/** Compose canonical model metadata with declarations from one subscription namespace. */
function subscriptionView(
  upstream: Upstream,
  registry: Registry,
  subscriptionId: string,
  upstreamSha256: string,
  access: Map<string, SubscriptionOffer[]>,
): ComposedSubscription {
  const definition = subscriptions.find((definition) => definition.id === subscriptionId);
  if (!definition) throw new Error(`Unknown subscription: ${subscriptionId}`);
  const models = Object.fromEntries(
    [...access.entries()].flatMap(([id, entries]) => {
      const access = entries.filter((entry) => entry.subscription === subscriptionId);
      if (!access.length) return [];
      const model = upstream.models[id] ?? { id, name: access[0]?.source_model ?? id };
      if ("subscription_access" in model)
        throw new Error("Upstream model enrichment field collision");
      return [[id, { ...model, subscription_access: access }]];
    }),
  );
  if (!Object.keys(models).length) throw new ModelCatalogUnavailableError(subscriptionId);
  return composedSubscriptionSchema.parse({
    ...definition,
    model_catalog: subscriptionCoverage(registry, definition.products),
    models,
    subscription_catalog: catalogMetadata(
      registry,
      upstreamSha256,
      Object.values(models).flatMap((model) => model.subscription_access),
    ),
  });
}

export class ModelCatalogUnavailableError extends Error {
  constructor(readonly subscriptionId: string) {
    super(`No verified public model catalog: ${subscriptionId}`);
    this.name = "ModelCatalogUnavailableError";
  }
}

/** Reuse one model index while composing immutable registry and upstream snapshots. */
export function createCatalogComposer(
  upstream: Upstream,
  registry: Registry,
  upstreamSha256: string,
) {
  const access = accessByModel(registry, upstream);
  return {
    provider: (id: string) => providerView(upstream, registry, id, upstreamSha256, access),
    subscription: (id: string) => subscriptionView(upstream, registry, id, upstreamSha256, access),
  };
}
export function composeProvider(
  upstream: Upstream,
  registry: Registry,
  id: string,
  upstreamSha256: string,
): ComposedProvider {
  return createCatalogComposer(upstream, registry, upstreamSha256).provider(id);
}
export function composeSubscription(
  upstream: Upstream,
  registry: Registry,
  id: string,
  upstreamSha256: string,
): ComposedSubscription {
  return createCatalogComposer(upstream, registry, upstreamSha256).subscription(id);
}
