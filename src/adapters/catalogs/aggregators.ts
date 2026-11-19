import { z } from "zod";
import { document, exactTable, text } from "./html.ts";
import type { CatalogParser } from "./types.ts";

const openCodeUrl = "https://opencode.ai/inference/go/v1/models";
const openCodeScope = "https://opencode.ai/docs/console/api/models/";
const openCodePlans = "https://opencode.ai/docs/console/go/";
const nativeModel = z
  .object({
    id: z.string().min(1),
    canonical_id: z.string().min(1).optional(),
    api: z.record(z.string(), z.object({ base_url: z.url() }).passthrough()).optional(),
    go: z
      .object({
        monthly_usage: z.record(z.string().min(1), z.number().nonnegative()).nullable(),
        training: z.boolean(),
        zdr: z.boolean(),
        limited_regions: z.boolean(),
      })
      .passthrough(),
  })
  .passthrough();
export const openCodeGo: CatalogParser = (bodies) => {
  const body = bodies[openCodeUrl];
  const scope = bodies[openCodeScope];
  if (!body || !scope || !text(document(scope)).includes("Each Go model also has"))
    throw new Error("Missing OpenCode plan field contract");
  const models = z
    .object({ object: z.literal("list"), data: z.array(nativeModel).min(1) })
    .parse(JSON.parse(body)).data;
  const planBody = bodies[openCodePlans];
  if (!planBody || !text(document(planBody)).includes("continue using the free models"))
    throw new Error("Missing OpenCode free-model scope");
  const plans = [...new Set(models.flatMap((model) => Object.keys(model.go.monthly_usage ?? {})))];
  if (!plans.length) throw new Error("Missing OpenCode plan keys");
  return models.flatMap((model) => {
    const cost = z
      .object({
        text: z.object({
          input: z.object({ price: z.number() }),
          output: z.object({ price: z.number() }),
        }),
      })
      .safeParse(model.cost);
    const free =
      model.go.monthly_usage === null &&
      cost.success &&
      cost.data.text.input.price === 0 &&
      cost.data.text.output.price === 0;
    const allowances =
      model.go.monthly_usage ?? Object.fromEntries(plans.map((plan) => [plan, null]));
    const groups = new Map<"available" | "unavailable" | "unknown", string[]>();
    for (const [plan, allowance] of Object.entries(allowances)) {
      const status =
        free || (allowance !== null && allowance > 0)
          ? "available"
          : allowance === 0
            ? "unavailable"
            : "unknown";
      groups.set(status, [...(groups.get(status) ?? []), plan]);
    }
    if (!groups.size) throw new Error("Empty OpenCode plan allowance map");
    return [...groups].map(([status, modelPlans]) => ({
      id: model.id,
      plans: modelPlans,
      status,
      ...(model.canonical_id ? { canonical_hint: model.canonical_id } : {}),
      api: Object.fromEntries(
        Object.entries(model.api ?? {}).map(([protocol, api]) => [protocol, api.base_url]),
      ),
      conditions: {
        monthly_usage_usd_by_plan: allowances,
        free,
        training: model.go.training,
        zdr: model.go.zdr,
        limited_regions: model.go.limited_regions,
      },
      evidence: [
        ...modelPlans.map((plan) => ({
          url: openCodeUrl,
          locator: `data[id=${model.id}].go.monthly_usage.${plan}`,
        })),
        { url: openCodeScope, locator: "Inference model lists: go fields" },
        { url: openCodePlans, locator: "Usage limits; free models" },
      ],
    }));
  });
};

const vercelUrl = "https://vercel.com/docs/ai-gateway/token-pass";
export const vercelTokenPass: CatalogParser = (bodies) => {
  const body = bodies[vercelUrl];
  if (!body) throw new Error("Missing Vercel Token Pass source");
  const content = text(document(body));
  for (const assertion of [
    "Token Pass credit covers these models",
    "featured models served by the Token Pass provider",
    "Pro teams",
  ]) {
    if (!content.includes(assertion)) throw new Error(`Vercel source scope changed: ${assertion}`);
  }
  const table = exactTable(body, ["Model", "Model ID"]);
  return table.rows.map((row) => {
    const id = row.codes[1]?.[0];
    if (!id || row.codes[1]?.length !== 1 || !id.includes("/"))
      throw new Error("Invalid Vercel request model ID");
    return {
      id,
      plans: ["Token Pass"],
      status: "available",
      conditions: { serving_provider: "token-pass", required_vercel_plan: "pro" },
      evidence: [{ url: vercelUrl, locator: `Featured models and providers;Model ID=${id}` }],
    };
  });
};
