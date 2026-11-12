import type { Registry } from "./schema.ts";
import { compare } from "./stable.ts";

export function coverage(registry: Registry) {
  return {
    providers: registry.providers.map((provider) => ({
      id: provider.id,
      state: provider.state,
      plans: [
        ...new Set(provider.claims.flatMap((claim) => (claim.plan === null ? [] : [claim.plan]))),
      ].sort(compare),
      claims: provider.claims.length,
      statuses: Object.fromEntries(
        ["available", "unavailable", "unknown"].map((status) => [
          status,
          provider.claims.filter((claim) => claim.status === status).length,
        ]),
      ),
      unresolved: [
        ...new Set(
          provider.claims
            .filter((claim) => claim.model_id === null)
            .map((claim) => claim.source_model),
        ),
      ].sort(compare),
    })),
    gaps: [
      {
        product: "openai-chatgpt",
        status: "unknown",
        source: "https://learn.chatgpt.com/docs/models",
        reason: "Codex declarations do not establish ChatGPT Chat access.",
      },
      {
        product: "anthropic-claude-code",
        status: "unknown",
        source: "https://code.claude.com/docs/en/model-config",
        reason:
          "No qualified public structured model-to-plan adapter. Defaults do not establish a complete grant list.",
      },
      {
        product: "anthropic-claude",
        status: "unknown",
        source: "https://www.anthropic.com/pricing",
        reason: "Claude Code declarations do not establish Claude web access.",
      },
      {
        product: "google-gemini-cli",
        status: "unknown",
        source: "https://geminicli.com/plans/",
        reason:
          "Client model categories and runtime access flags do not establish a subscription mapping.",
      },
      {
        product: "google-gemini",
        status: "unknown",
        source: "https://gemini.google/subscriptions/",
        reason: "No qualified adapter for exact model identity and plan evidence.",
      },
    ],
  };
}
