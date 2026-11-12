import { z } from "zod";
import type { ExtractedClaim } from "../schema.ts";
import type { Adapter } from "./types.ts";
import { sourceBody } from "./types.ts";

const modelSchema = z
  .object({
    slug: z.string().min(1),
    visibility: z.enum(["list", "hide"]),
    supported_in_api: z.boolean(),
    minimal_client_version: z.string().min(1),
    available_in_plans: z.array(z.string().min(1)).optional(),
  })
  .passthrough();
export const codex: Adapter = {
  id: "openai-codex",
  async load(loader) {
    return [await loader("openai/codex", "codex-rs/models-manager/models.json", "codex-models")];
  },
  parse(sources) {
    const { models } = z
      .object({ models: z.array(modelSchema).min(1) })
      .strict()
      .parse(JSON.parse(sourceBody(sources, "codex-models")));
    if (new Set(models.map((model) => model.slug)).size !== models.length)
      throw new Error("Duplicate Codex slugs");
    return models.flatMap((model): ExtractedClaim[] => {
      const plans = model.available_in_plans;
      if (plans && new Set(plans).size !== plans.length)
        throw new Error("Duplicate Codex plan tokens");
      const base = {
        product: "openai-codex",
        provider: "openai",
        source_model: model.slug,
        surface: "cli",
        variant: null,
        minimum_client_version: model.minimal_client_version,
        evidence: [{ source: "codex-models", locator: `slug=${model.slug}` }],
      };
      return [
        ...(plans?.length ? plans : [null]).map(
          (plan): ExtractedClaim => ({
            ...base,
            channel: "subscription",
            plan,
            status: plan !== null && model.visibility === "list" ? "available" : "unknown",
            reason:
              model.visibility === "hide"
                ? "hidden-client-model"
                : plan === null
                  ? "no-explicit-plan-evidence"
                  : "declared-in-client-plan-catalog",
          }),
        ),
        {
          ...base,
          channel: "api",
          plan: null,
          status: model.supported_in_api ? "unknown" : "unavailable",
          reason: model.supported_in_api
            ? "api-support-does-not-establish-account-access"
            : "explicit-client-api-exclusion",
        },
      ];
    });
  },
};
