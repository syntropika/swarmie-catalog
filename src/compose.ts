import { query } from "./query.ts";
import {
  type ComposedProvider,
  composedProviderSchema,
  type Registry,
  type SubscriptionOffer,
  type Upstream,
} from "./schema.ts";
import { compare, stable } from "./stable.ts";

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
  const declarations = query(registry, {
    channel: "subscription",
    includeStale: true,
    includeUnresolved: false,
  });
  const owners = new Map(registry.providers.map((item) => [item.id, item]));
  const requiredSources = new Set<string>();
  const models = Object.fromEntries(
    Object.entries(provider.models)
      .sort(([a], [b]) => compare(a, b))
      .map(([id, model]) => {
        if ("subscription_access" in model)
          throw new Error("Upstream model enrichment field collision");
        const direct = `${providerId}/${id}`;
        const candidate = model.canonical_model_id ?? (upstream.models[direct] ? direct : null);
        const canonical = candidate !== null && upstream.models[candidate] ? candidate : null;
        const offers =
          canonical === null
            ? []
            : declarations
                .filter((claim) => claim.model_id === canonical)
                .map((claim) => {
                  const owner = owners.get(claim.product);
                  if (!owner) throw new Error(`Missing declaration owner: ${claim.product}`);
                  for (const evidence of claim.evidence) requiredSources.add(evidence.source);
                  return {
                    ...claim,
                    state: owner.state,
                    error: owner.error,
                    source_updated_at: owner.source_updated_at,
                  };
                });
        const groups = new Map<string, SubscriptionOffer>();
        for (const { plan, evidence, ...conditions } of offers) {
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
        const access = [...groups.entries()]
          .sort(([a], [b]) => compare(a, b))
          .map(([, group]) => ({
            ...group,
            plans: group.plans.sort((a, b) =>
              a === b ? 0 : a === null ? -1 : b === null ? 1 : compare(a, b),
            ),
            evidence: group.evidence.sort((a, b) => compare(stable(a), stable(b))),
          }));
        return [id, { ...model, subscription_access: access }];
      }),
  );
  const sources = registry.providers
    .flatMap((item) => item.sources)
    .filter((source) => requiredSources.has(source.id))
    .sort((a, b) => compare(a.id, b.id));
  return composedProviderSchema.parse({
    ...provider,
    models,
    subscription_catalog: {
      schema_version: 2,
      upstream: { url: registry.upstream, sha256: upstreamSha256 },
      sources,
    },
  });
}
