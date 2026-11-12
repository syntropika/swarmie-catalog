import { parseDocument } from "yaml";
import { z } from "zod";
import type { Availability, ExtractedClaim } from "../schema.ts";
import type { Adapter } from "./types.ts";
import { sourceBody } from "./types.ts";

export const copilotPlans = ["free", "pro", "pro_plus", "max", "business", "enterprise"] as const;
export const copilotClients = [
  "dotcom",
  "cli",
  "vscode",
  "vs",
  "eclipse",
  "xcode",
  "jetbrains",
] as const;
const optionalFlag = z.boolean().optional();
const planRow = z
  .object({
    name: z.string().min(1),
    free: optionalFlag,
    pro: optionalFlag,
    pro_plus: optionalFlag,
    max: optionalFlag,
    business: optionalFlag,
    enterprise: optionalFlag,
  })
  .strict();
const clientRow = z
  .object({
    name: z.string().min(1),
    dotcom: optionalFlag,
    cli: optionalFlag,
    vscode: optionalFlag,
    vs: optionalFlag,
    eclipse: optionalFlag,
    xcode: optionalFlag,
    jetbrains: optionalFlag,
  })
  .strict();
function yaml(body: string): unknown {
  const document = parseDocument(body, { uniqueKeys: true });
  if (document.errors.length) throw new Error("Invalid YAML document");
  return document.toJS({ maxAliasCount: 0 });
}
function rows<T extends { name: string }>(items: T[]): T[] {
  if (new Set(items.map((item) => item.name)).size !== items.length)
    throw new Error("Duplicate model rows");
  if (items.length === 0) throw new Error("Empty model table");
  return items;
}
export function flag(value: boolean | undefined): Availability {
  return value === true ? "available" : value === false ? "unavailable" : "unknown";
}
export const copilot: Adapter = {
  id: "github-copilot",
  async load(loader) {
    return Promise.all([
      loader("github/docs", "data/tables/copilot/model-supported-plans.yml", "copilot-plans"),
      loader("github/docs", "data/tables/copilot/model-supported-clients.yml", "copilot-clients"),
    ]);
  },
  parse(sources) {
    const plans = rows(z.array(planRow).parse(yaml(sourceBody(sources, "copilot-plans"))));
    const clients = rows(z.array(clientRow).parse(yaml(sourceBody(sources, "copilot-clients"))));
    const claims: ExtractedClaim[] = [];
    for (const model of plans) {
      if (!copilotPlans.some((key) => model[key] !== undefined))
        throw new Error("Plan row has no availability fields");
      const client = clients.find((row) => row.name === model.name);
      for (const plan of copilotPlans) {
        for (const surface of [null, ...copilotClients]) {
          const planStatus = flag(model[plan]);
          const clientStatus = surface === null ? "available" : flag(client?.[surface]);
          const status =
            planStatus === "unavailable" || clientStatus === "unavailable"
              ? "unavailable"
              : planStatus === "available" && clientStatus === "available"
                ? "available"
                : "unknown";
          claims.push({
            product: "github-copilot",
            provider: "github",
            source_model: model.name,
            channel: "subscription",
            plan,
            surface,
            variant: null,
            minimum_client_version: null,
            status,
            reason:
              status === "unknown"
                ? "missing-plan-or-client-evidence"
                : "explicit-plan-and-client-flags",
            evidence: [
              { source: "copilot-plans", locator: `name=${model.name};column=${plan}` },
              ...(surface !== null && client
                ? [{ source: "copilot-clients", locator: `name=${model.name};column=${surface}` }]
                : []),
            ],
          });
        }
      }
    }
    for (const client of clients) {
      if (!plans.some((row) => row.name === client.name))
        throw new Error(`Client row has no plan row: ${client.name}`);
    }
    return claims;
  },
};
