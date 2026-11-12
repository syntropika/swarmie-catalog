import { query } from "./query.ts";
import {
  type ComposedProvider,
  composedProviderSchema,
  type Registry,
  type Upstream,
} from "./schema.ts";
import { compare } from "./stable.ts";

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
        const supported = offers.some(
          (offer) => offer.state === "current" && offer.status === "available",
        );
        return [
          id,
          {
            ...model,
            subscription_access: {
              status: supported ? "available" : "unknown",
              model_id: canonical,
              reason:
                canonical === null
                  ? "unresolved-canonical-identity"
                  : supported
                    ? "explicit-source-declaration"
                    : offers.length
                      ? "no-current-positive-declaration"
                      : "no-source-evidence",
              offers,
            },
          },
        ];
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
      schema_version: 1,
      upstream: { url: registry.upstream, sha256: upstreamSha256 },
      sources,
    },
  });
}

/** Select models with explicit current support in the requested product and plan. */
export function selectSubscriptionModels(
  provider: ComposedProvider,
  scope: { product?: string; plan?: string } = {},
): ComposedProvider {
  if (scope.plan !== undefined && scope.product === undefined)
    throw new Error("A plan requires its product namespace");
  const matches = (
    offer: ComposedProvider["models"][string]["subscription_access"]["offers"][number],
  ) =>
    (scope.product === undefined || offer.product === scope.product) &&
    (scope.plan === undefined || offer.plan === scope.plan);
  const models = Object.fromEntries(
    Object.entries(provider.models).flatMap(([id, model]) => {
      const offers = model.subscription_access.offers.filter(matches);
      if (!offers.some((offer) => offer.state === "current" && offer.status === "available"))
        return [];
      return [
        [
          id,
          {
            ...model,
            subscription_access: {
              ...model.subscription_access,
              status: "available" as const,
              reason: "explicit-source-declaration" as const,
              offers,
            },
          },
        ],
      ];
    }),
  );
  return {
    ...provider,
    models,
    subscription_catalog: {
      ...provider.subscription_catalog,
      selection: { status: "available", ...scope },
    },
  };
}
