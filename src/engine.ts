import type { Adapter } from "./adapters/types.ts";
import { type SourceLoader, SyncError } from "./fetch.ts";
import { reconcile } from "./reconcile.ts";
import {
  type Aliases,
  type Claim,
  claimSchema,
  type ProviderData,
  type Registry,
  registrySchema,
  sourceSchema,
  type Upstream,
} from "./schema.ts";
import { compare, hash, stable } from "./stable.ts";

export const upstreamUrl = "https://models.dev/catalog.json?type=all" as const;
export function emptyRegistry(): Registry {
  return { schema_version: 1, upstream: upstreamUrl, providers: [] };
}
export function claimKey(claim: Claim): string {
  return JSON.stringify([
    claim.product,
    claim.source_model,
    claim.channel,
    claim.plan,
    claim.surface,
    claim.variant,
  ]);
}
export function validateRegistry(input: unknown): Registry {
  const registry = registrySchema.parse(input);
  const ids = new Set<string>();
  for (const provider of registry.providers) {
    if (ids.has(provider.id)) throw new Error("Duplicate provider");
    ids.add(provider.id);
    if ((provider.state === "current") !== (provider.error === null))
      throw new Error("Invalid provider health");
    const sources = new Map(provider.sources.map((source) => [source.id, source]));
    if (sources.size !== provider.sources.length) throw new Error("Duplicate sources");
    const claims = new Set<string>();
    for (const claim of provider.claims) {
      if (claim.product !== provider.id)
        throw new Error("Claim belongs to a different provider adapter");
      const key = claimKey(claim);
      if (claims.has(key)) throw new Error("Duplicate claim");
      claims.add(key);
      for (const evidence of claim.evidence) {
        if (!sources.has(evidence.source)) throw new Error("Claim has no source provenance");
      }
    }
  }
  return registry;
}
function orderedClaims(claims: Claim[]): Claim[] {
  return claims
    .map((claim) => ({
      ...claim,
      evidence: [...new Map(claim.evidence.map((item) => [stable(item), item])).values()].sort(
        (a, b) => compare(stable(a), stable(b)),
      ),
    }))
    .sort((a, b) => compare(claimKey(a), claimKey(b)));
}
function semanticClaims(claims: Claim[]): string {
  return stable(
    claims.map((claim) => ({
      ...claim,
      evidence: claim.evidence.map((evidence) => ({
        ...evidence,
        source: evidence.source.replace(/@[a-f0-9]{64}$/, ""),
      })),
    })),
  );
}
function deduplicate(claims: Claim[]): Claim[] {
  const result = new Map<string, Claim>();
  for (const claim of claims) {
    const key = claimKey(claim);
    const prior = result.get(key);
    if (
      prior &&
      (prior.status !== claim.status ||
        prior.model_id !== claim.model_id ||
        prior.reason !== claim.reason)
    ) {
      throw new SyncError("conflicting-evidence", `Conflicting claims: ${key}`);
    }
    result.set(key, prior ? { ...claim, evidence: [...prior.evidence, ...claim.evidence] } : claim);
  }
  return orderedClaims([...result.values()]);
}
function guardChanges(old: ProviderData | undefined, claims: Claim[]): Claim[] {
  if (claims.length === 0) throw new SyncError("empty-provider", "Provider returned no claims");
  if (!old) return claims;
  const candidates = new Map(claims.map((claim) => [claimKey(claim), claim]));
  const resolved = old.claims.filter((claim) => claim.model_id !== null);
  const identityLoss = resolved.filter(
    (claim) => candidates.get(claimKey(claim))?.model_id === null,
  );
  if (resolved.length > 0 && identityLoss.length / resolved.length > 0.2) {
    throw new SyncError(
      "mass-identity-loss",
      "More than 20% of resolved scopes lost their canonical identity",
    );
  }
  const newModels = new Set(claims.map((claim) => claim.source_model));
  const oldModels = new Set(
    old.claims
      .filter((claim) => claim.reason !== "source-no-longer-lists-scope")
      .map((claim) => claim.source_model),
  );
  const missing = [...oldModels].filter((model) => !newModels.has(model));
  if (missing.length > 0 && missing.length / oldModels.size > 0.2) {
    throw new SyncError("mass-removal", "More than 20% of source models disappeared");
  }
  const previousAvailable = old.claims.filter((claim) => claim.status === "available");
  const availableKeys = new Set(
    claims.filter((claim) => claim.status === "available").map(claimKey),
  );
  const lost = previousAvailable.filter((claim) => !availableKeys.has(claimKey(claim)));
  if (previousAvailable.length > 0 && lost.length / previousAvailable.length > 0.35) {
    throw new SyncError("mass-availability-loss", "More than 35% of positive claims changed");
  }
  const keys = new Set(claims.map(claimKey));
  return orderedClaims([
    ...claims,
    ...old.claims
      .filter((claim) => !keys.has(claimKey(claim)))
      .map(
        (claim): Claim => ({
          ...claim,
          status: "unknown",
          reason: "source-no-longer-lists-scope",
        }),
      ),
  ]);
}
export interface SyncResult {
  registry: Registry;
  failures: { provider: string; code: string; message: string }[];
  verified: string[];
  changed: boolean;
  report: string;
}
export async function synchronize(options: {
  previous: Registry;
  upstream: Upstream;
  adapters: Adapter[];
  loader: SourceLoader;
  aliases: Aliases;
  now: string;
}): Promise<SyncResult> {
  const previous = validateRegistry(options.previous);
  const providers = new Map(previous.providers.map((provider) => [provider.id, provider]));
  const failures: SyncResult["failures"] = [];
  const verified: string[] = [];
  if (new Set(options.adapters.map((adapter) => adapter.id)).size !== options.adapters.length)
    throw new Error("Duplicate adapters");
  for (const adapter of options.adapters) {
    const old = providers.get(adapter.id);
    try {
      const snapshots = await adapter.load(options.loader);
      if (
        !snapshots.length ||
        new Set(snapshots.map((snapshot) => snapshot.source.id)).size !== snapshots.length
      )
        throw new Error("Invalid source set");
      for (const snapshot of snapshots) {
        sourceSchema.parse(snapshot.source);
        if (hash(snapshot.body) !== snapshot.source.sha256)
          throw new Error("Source digest mismatch");
      }
      const sources = snapshots.map(({ source }) => ({
        ...source,
        id: `${source.id}@${source.sha256}`,
      }));
      const sourceIds = new Map(
        snapshots.map((snapshot, index) => [snapshot.source.id, sources[index]?.id]),
      );
      const extracted = adapter.parse(snapshots);
      const claims = guardChanges(
        old,
        deduplicate(
          extracted.map((claim) =>
            claimSchema.parse({
              ...reconcile(claim, options.upstream, options.aliases),
              evidence: claim.evidence.map((evidence) => {
                const source = sourceIds.get(evidence.source);
                if (!source) throw new Error("Extractor referenced an unknown source");
                return { ...evidence, source };
              }),
            }),
          ),
        ),
      );
      const requiredSources = new Set(
        claims.flatMap((claim) => claim.evidence.map((evidence) => evidence.source)),
      );
      const allSources = [
        ...new Map(
          [...sources, ...(old?.sources ?? [])].map((source) => [source.id, source]),
        ).values(),
      ]
        .filter((source) => requiredSources.has(source.id))
        .sort((a, b) => compare(a.id, b.id));
      const next: ProviderData = {
        id: adapter.id,
        state: "current",
        error: null,
        source_updated_at: sources.reduce(
          (latest, source) => (source.modified_at > latest ? source.modified_at : latest),
          "",
        ),
        sources: allSources,
        claims,
      };
      if (old && semanticClaims(old.claims) === semanticClaims(next.claims)) {
        next.claims = old.claims;
        next.sources = old.sources;
        next.source_updated_at = old.source_updated_at;
      }
      validateRegistry({ ...emptyRegistry(), providers: [next] });
      providers.set(adapter.id, next);
      verified.push(adapter.id);
    } catch (error) {
      const code = error instanceof SyncError ? error.code : "invalid-provider-data";
      failures.push({
        provider: adapter.id,
        code,
        message: error instanceof Error ? error.message : "Provider failed",
      });
      if (old) providers.set(adapter.id, { ...old, state: "stale", error: code });
    }
  }
  const registry = validateRegistry({
    ...emptyRegistry(),
    providers: [...providers.values()].sort((a, b) => compare(a.id, b.id)),
  });
  const changed = stable(registry) !== stable(previous);
  const before = new Map(
    previous.providers.flatMap((provider) =>
      provider.claims.map((claim) => [claimKey(claim), claim] as const),
    ),
  );
  const after = new Map(
    registry.providers.flatMap((provider) =>
      provider.claims.map((claim) => [claimKey(claim), claim] as const),
    ),
  );
  const additions = [...after.keys()].filter((key) => !before.has(key));
  const changes = [...after].filter(([key, value]) => {
    const prior = before.get(key);
    return (
      prior &&
      stable({
        status: prior.status,
        model: prior.model_id,
        reason: prior.reason,
        version: prior.minimum_client_version,
      }) !==
        stable({
          status: value.status,
          model: value.model_id,
          reason: value.reason,
          version: value.minimum_client_version,
        })
    );
  });
  const report = [
    "# Synchronization report",
    "",
    `Checked at: ${options.now}`,
    "",
    `Catalog changed: ${changed}. Added scopes: ${additions.length}. Changed scopes: ${changes.length}.`,
    "",
    "| Provider | State | Claims | Unresolved model names |",
    "| --- | --- | ---: | ---: |",
    ...registry.providers.map(
      (provider) =>
        `| ${provider.id} | ${provider.state} | ${provider.claims.length} | ${new Set(provider.claims.filter((claim) => claim.model_id === null).map((claim) => claim.source_model)).size} |`,
    ),
    "",
    ...failures.map(
      (failure) =>
        `- Failed: ${failure.provider} (${failure.code}). Previous data retained when present.`,
    ),
    "",
    "## Models with added scopes",
    "",
    ...[
      ...new Set(
        [...after]
          .filter(([key]) => !before.has(key))
          .map(([, claim]) => `${claim.product}: ${claim.source_model}`),
      ),
    ].map((model) => `- ${model}`),
    "",
    "## Availability changes",
    "",
    ...changes.map(
      ([, claim]) =>
        `- ${claim.product}: ${claim.source_model}, ${claim.channel}, ${claim.plan ?? "unspecified plan"}, ${claim.surface ?? "unspecified surface"}: ${before.get(claimKey(claim))?.status} → ${claim.status} (${claim.reason}).`,
    ),
    "",
    "## Unresolved identities",
    "",
    ...registry.providers.flatMap((provider) =>
      [
        ...new Set(
          provider.claims
            .filter((claim) => claim.model_id === null)
            .map((claim) => claim.source_model),
        ),
      ].map((name) => `- ${provider.id}: ${name}`),
    ),
    "",
  ].join("\n");
  return { registry, failures, verified, changed, report };
}
