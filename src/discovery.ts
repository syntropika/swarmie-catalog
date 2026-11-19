import { z } from "zod";

const text = z.string().min(1);
export const documentationSourceSchema = z
  .object({
    id: text,
    url: z.url().refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    }),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    capture_kind: z.enum(["http-body", "web-extract"]),
  })
  .strict();

export const discoveryStepSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("http"),
      method: z.literal("GET"),
      url: documentationSourceSchema.shape.url,
      authentication: z.literal("connection-credentials"),
      format: z.enum(["chatgpt-models", "openai-models"]),
      evidence: z.array(text).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("json-rpc"),
      runtime: z.literal("codex"),
      method: z.literal("model/list"),
      params: z.object({ includeHidden: z.literal(false) }).strict(),
      authentication: z.literal("connection-credentials"),
      format: z.literal("codex-models"),
      evidence: z.array(text).min(1),
    })
    .strict(),
]);

export const discoveryMethodSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("documented"),
      combine: z.literal("intersection"),
      steps: z.array(discoveryStepSchema).min(1),
      reviewed_on: z.iso.date(),
      sources: z.array(documentationSourceSchema).min(1),
    })
    .strict(),
  z
    .object({ kind: z.literal("unavailable"), reason: z.literal("no-reviewed-discovery-method") })
    .strict(),
]);

export const modelDiscoverySchema = z
  .object({
    requirement: z.literal("required"),
    static_fallback: z.literal(false),
    context: z.tuple([
      z.literal("connection"),
      z.literal("account"),
      z.literal("workspace"),
      z.literal("authorization"),
      z.literal("runtime"),
    ]),
    refresh_on: z.tuple([
      z.literal("connect"),
      z.literal("context-change"),
      z.literal("model-rejection"),
    ]),
    method: discoveryMethodSchema,
  })
  .strict();

export const discoveryProfilesSchema = z
  .object({
    schema_version: z.literal(1),
    profiles: z.array(
      z
        .object({
          connection_id: text,
          oauth_scopes: z.array(text).nullable(),
          method: discoveryMethodSchema,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const ids = new Set<string>();
    for (const profile of manifest.profiles) {
      if (ids.has(profile.connection_id))
        ctx.addIssue({
          code: "custom",
          message: `Duplicate discovery profile: ${profile.connection_id}`,
        });
      ids.add(profile.connection_id);
      if (profile.method.kind !== "documented") continue;
      const sources = new Set(profile.method.sources.map((source) => source.id));
      if (sources.size !== profile.method.sources.length)
        ctx.addIssue({ code: "custom", message: "Duplicate discovery source" });
      for (const step of profile.method.steps) {
        for (const source of step.evidence) {
          if (!sources.has(source))
            ctx.addIssue({ code: "custom", message: `Missing discovery evidence: ${source}` });
        }
      }
    }
  });

export type ModelDiscovery = z.infer<typeof modelDiscoverySchema>;
export type DiscoveryStep = z.infer<typeof discoveryStepSchema>;

/** Require connection-scoped discovery even when no reviewed discovery procedure exists. */
export function modelDiscovery(method: z.infer<typeof discoveryMethodSchema>): ModelDiscovery {
  return modelDiscoverySchema.parse({
    requirement: "required",
    static_fallback: false,
    context: ["connection", "account", "workspace", "authorization", "runtime"],
    refresh_on: ["connect", "context-change", "model-rejection"],
    method,
  });
}

const chatgptPageSchema = z.object({
  models: z.array(z.object({ slug: text, display_name: text, visibility: text }).passthrough()),
});
const apiPageSchema = z.object({ data: z.array(z.object({ id: text }).passthrough()) });
const codexPageSchema = z.object({
  data: z.array(z.object({ model: text, displayName: text, hidden: z.boolean() }).passthrough()),
  nextCursor: text.nullable(),
});

export interface DiscoveredModel {
  request_model_id: string;
  name: string;
}

/** Parse a provider response body or an unwrapped successful RPC result. Preserve native IDs. */
export function readModelPage(format: DiscoveryStep["format"], body: unknown) {
  if (format === "chatgpt-models") {
    const page = chatgptPageSchema.parse(body);
    return {
      models: page.models
        .filter((model) => model.visibility === "list")
        .map((model) => ({ request_model_id: model.slug, name: model.display_name })),
      next_cursor: null,
    };
  }
  if (format === "openai-models") {
    const page = apiPageSchema.parse(body);
    return {
      models: page.data.map((model) => ({ request_model_id: model.id, name: model.id })),
      next_cursor: null,
    };
  }
  const page = codexPageSchema.parse(body);
  return {
    models: page.data
      .filter((model) => !model.hidden)
      .map((model) => ({ request_model_id: model.model, name: model.displayName })),
    next_cursor: page.nextCursor,
  };
}

export class ModelDiscoveryError extends Error {
  constructor(
    readonly code: "unavailable" | "context-mismatch" | "incomplete" | "invalid-response",
  ) {
    super(`Model discovery failed: ${code}`);
    this.name = "ModelDiscoveryError";
  }
}

/**
 * Resolve complete discovery responses for one current connection context.
 * The host owns authenticated transport, RPC initialization, pagination and context invalidation.
 * The context key must change with account, workspace, authorization or runtime configuration.
 */
export function resolveDiscoveredModels(
  connection: { id: string; model_discovery: ModelDiscovery },
  currentContextKey: string,
  result: { connection_id: string; context_key: string; steps: unknown[][] },
): DiscoveredModel[] {
  const method = connection.model_discovery.method;
  if (method.kind !== "documented") throw new ModelDiscoveryError("unavailable");
  if (
    !currentContextKey ||
    result.connection_id !== connection.id ||
    result.context_key !== currentContextKey
  )
    throw new ModelDiscoveryError("context-mismatch");
  if (result.steps.length !== method.steps.length) throw new ModelDiscoveryError("incomplete");
  const sets = method.steps.map((step, index) => {
    const pages = result.steps[index];
    if (!pages?.length || (step.kind === "http" && pages.length !== 1))
      throw new ModelDiscoveryError("incomplete");
    const models: DiscoveredModel[] = [];
    const cursors = new Set<string>();
    for (const [pageIndex, body] of pages.entries()) {
      let page: ReturnType<typeof readModelPage>;
      try {
        page = readModelPage(step.format, body);
      } catch {
        throw new ModelDiscoveryError("invalid-response");
      }
      if (page.next_cursor !== null) {
        if (pageIndex === pages.length - 1 || cursors.has(page.next_cursor))
          throw new ModelDiscoveryError("incomplete");
        cursors.add(page.next_cursor);
      } else if (pageIndex !== pages.length - 1) {
        throw new ModelDiscoveryError("invalid-response");
      }
      models.push(...page.models);
    }
    if (new Set(models.map((model) => model.request_model_id)).size !== models.length)
      throw new ModelDiscoveryError("invalid-response");
    return models;
  });
  const first = sets[0];
  if (!first) throw new ModelDiscoveryError("incomplete");
  const accepted = sets
    .slice(1)
    .map((models) => new Set(models.map((model) => model.request_model_id)));
  return first.filter((model) => accepted.every((ids) => ids.has(model.request_model_id)));
}
