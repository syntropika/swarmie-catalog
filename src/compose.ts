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
import { subscriptionForProduct, subscriptions } from "./subscriptions.ts";

function accessByModel(registry: Registry): Map<string, SubscriptionOffer[]> {
  const owners = new Map(registry.providers.map((item) => [item.id, item]));
  const groups = new Map<string, SubscriptionOffer>();
  const declarations = query(registry, {
    channel: "subscription",
    includeStale: true,
    includeUnresolved: false,
  });
  for (const { plan, evidence, ...claim } of declarations) {
    const owner = owners.get(claim.product);
    if (!owner) throw new Error(`Missing declaration owner: ${claim.product}`);
    const conditions = {
      ...claim,
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
    if (group.model_id === null) throw new Error("Unresolved grouped subscription identity");
    group.plans.sort((a, b) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : compare(a, b)));
    group.evidence.sort((a, b) => compare(stable(a), stable(b)));
    const entries = models.get(group.model_id) ?? [];
    entries.push(group);
    models.set(group.model_id, entries);
  }
  return models;
}

function catalogMetadata(registry: Registry, upstreamSha256: string, entries: SubscriptionOffer[]) {
  const requiredSources = new Set(
    entries.flatMap((entry) => entry.evidence.map((item) => item.source)),
  );
  return {
    schema_version: 2 as const,
    upstream: { url: registry.upstream, sha256: upstreamSha256 },
    sources: registry.providers
      .flatMap((item) => item.sources)
      .filter((source) => requiredSources.has(source.id))
      .sort((a, b) => compare(a.id, b.id)),
  };
}

/** Preserve upstream offerings and join source declarations through exact canonical identities. */
export function composeProvider(
  upstream: Upstream,
  registry: Registry,
  providerId: string,
  upstreamSha256: string,
): ComposedProvider {
  const provider = upstream.providers[providerId];
  if (!provider) throw new Error(`Unknown upstream provider: ${providerId}`);
  if ("subscription_catalog" in provider) throw new Error("Upstream enrichment field collision");
  const access = accessByModel(registry);
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
    models,
    subscription_catalog: catalogMetadata(
      registry,
      upstreamSha256,
      Object.values(models).flatMap((model) => model.subscription_access),
    ),
  });
}

/** Compose canonical model metadata with declarations from one subscription namespace. */
export function composeSubscription(
  upstream: Upstream,
  registry: Registry,
  subscriptionId: string,
  upstreamSha256: string,
): ComposedSubscription {
  const definition = subscriptions.find((definition) => definition.id === subscriptionId);
  if (!definition) throw new Error(`Unknown subscription: ${subscriptionId}`);
  const models = Object.fromEntries(
    [...accessByModel(registry).entries()].flatMap(([id, entries]) => {
      const access = entries.filter((entry) => entry.subscription === subscriptionId);
      const model = upstream.models[id];
      if (!model || !access.length) return [];
      if ("subscription_access" in model)
        throw new Error("Upstream model enrichment field collision");
      return [[id, { ...model, subscription_access: access }]];
    }),
  );
  return composedSubscriptionSchema.parse({
    ...definition,
    models,
    subscription_catalog: catalogMetadata(
      registry,
      upstreamSha256,
      Object.values(models).flatMap((model) => model.subscription_access),
    ),
  });
}
