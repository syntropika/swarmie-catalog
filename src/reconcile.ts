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
  const alias = aliases[`${claim.product}:${claim.source_model}`];
  if (alias) {
    if (!upstream.models[alias.model_id])
      throw new Error(`Alias target is missing: ${alias.model_id}`);
    return { ...claim, model_id: alias.model_id, variant: alias.variant };
  }
  const provider =
    claim.product === "github-copilot"
      ? "github-copilot"
      : claim.product === "openai-codex"
        ? "openai"
        : null;
  if (provider === null) throw new Error(`Unsupported identity namespace: ${claim.product}`);
  const id = provider === "github-copilot" ? copilotSlug(claim.source_model) : claim.source_model;
  const offering = upstream.providers[provider]?.models[id];
  const linked = offering?.canonical_model_id;
  if (linked && !upstream.models[linked])
    throw new Error(`Broken upstream canonical link: ${linked}`);
  const direct = provider === "openai" ? `openai/${id}` : null;
  if (linked && direct && upstream.models[direct] && linked !== direct)
    throw new Error(`Conflicting canonical identity: ${id}`);
  return { ...claim, model_id: linked ?? (direct && upstream.models[direct] ? direct : null) };
}
