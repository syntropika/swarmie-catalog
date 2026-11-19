import { modelSources } from "./model-sources.ts";
import type { Aliases, Claim, ExtractedClaim, Upstream } from "./schema.ts";

/** Normalize only the documented Copilot display-name punctuation convention. */
export function copilotSlug(name: string): string {
  return name
    .replace(/\[\^[^\]]*\]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
export function reconcile(claim: ExtractedClaim, upstream: Upstream, aliases: Aliases): Claim {
  const { canonical_hint, ...value } = claim;
  const alias = aliases[`${claim.product}:${claim.source_model}`];
  if (alias) {
    if (!upstream.models[alias.model_id])
      throw new Error(`Alias target is missing: ${alias.model_id}`);
    return { ...value, model_id: alias.model_id, variant: alias.variant };
  }
  const provider =
    claim.product === "github-copilot"
      ? "github-copilot"
      : claim.product === "openai-codex"
        ? "openai"
        : (modelSources.products.find((definition) => definition.product === claim.product)
            ?.offering_provider ?? null);
  if (provider === null) throw new Error(`Unsupported identity namespace: ${claim.product}`);
  const id =
    provider === "github-copilot"
      ? copilotSlug(claim.source_model)
      : (claim.request_model_id ?? claim.source_model);
  const offering = upstream.providers[provider]?.models[id];
  const linked = offering?.canonical_model_id;
  if (linked && !upstream.models[linked])
    return {
      ...value,
      model_id: null,
      conditions: { ...value.conditions, canonical_identity_issue: "broken-upstream-link" },
    };
  const direct = linked
    ? null
    : upstream.models[id]
      ? id
      : upstream.models[`${provider}/${id}`]
        ? `${provider}/${id}`
        : null;
  const hinted = canonical_hint && upstream.models[canonical_hint] ? canonical_hint : null;
  if (hinted && ((linked && hinted !== linked) || (direct && hinted !== direct)))
    return {
      ...value,
      model_id: null,
      conditions: {
        ...value.conditions,
        canonical_identity_issue: "conflicting-source-canonical-link",
      },
    };

  return {
    ...value,
    request_model_id: claim.request_model_id ?? (offering ? id : null),
    model_id: linked ?? direct ?? hinted,
  };
}
