import { parse } from "parse5";
import { sakana, sarvam, zeldoc } from "./native-services.ts";
import { requiredValue } from "./validation.ts";

type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | {
      [key: string]: Json;
    };
type ObjectValue = Record<string, unknown>;
type Evidence = {
  url: string;
  locator: string;
};
export type Extracted = {
  id: string;
  plans: string[];
  status: "available" | "unavailable" | "unknown";
  conditions?: Record<string, Json>;
  api?: Record<string, string>;
  evidence: Evidence[];
};
type Html = {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: {
    name: string;
    value: string;
  }[];
  childNodes?: Html[];
};
const urls = {
  kenariPlans: "https://kenari.id/api/plans",
  kenariPricing: "https://kenari.id/api/public/pricing",
  kenariDocs: "https://kenari.id/docs/subscriptions",
  moneoModels: "https://api.moneo.one/v1/models",
  moneoPlans: "https://supabase.moneo.one/functions/v1/public-tariffs",
  moneoScope: "https://moneo.one/price.html",
  unbiasedSchema: "https://unbiased.ai/openapi.json",
  unbiasedPlans: "https://unbiased.ai/pricing/",
  bergetModels: "https://api.berget.ai/v1/models",
  bergetPlans: "https://berget.ai/en/pricing",
  ablitModels: "https://docs.abliteration.ai/models.md",
  ablitRates: "https://docs.abliteration.ai/pricing.md",
  ablitPlans: "https://abliteration.ai/pricing",
  frogbotModels: "https://docs.frogbot.ai/api-reference/models.md",
  frogbotScope: "https://docs.frogbot.ai/balance-usage-pricing.md",
  sakanaModels: "https://console.sakana.ai/models",
  sakanaPlans: "https://console.sakana.ai/pricing",
  zeldocPlans: "https://zeldoc.ai/en/pricing",
  zeldocDocs: "https://docs.zeldoc.ai/what-is-zeldoc/",
  sarvamModels: "https://docs.sarvam.ai/api/token-factory/models.md",
  sarvamPlans: "https://www.sarvam.ai/api-pricing",
};
function object(value: unknown): ObjectValue {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected object");
  return value as ObjectValue;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected array");
  return value;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Expected nonempty string");
  return value;
}
function strings(value: unknown): string[] {
  return array(value).map(string);
}
function source(bodies: Record<string, string>, url: string): string {
  const value = bodies[url];
  if (value === undefined || !value.trim()) throw new Error(`Missing body: ${url}`);
  return value;
}
function json(bodies: Record<string, string>, url: string): unknown {
  return JSON.parse(source(bodies, url));
}
function requireText(value: string, needle: string): void {
  if (!value.includes(needle)) throw new Error(`Source contract changed: ${needle}`);
}
function unique(values: string[]): string[] {
  return [...new Set(values)];
}
function root(value: string): Html {
  return parse(value) as unknown as Html;
}
function descendants(node: Html, predicate: (node: Html) => boolean): Html[] {
  const found: Html[] = [];
  if (predicate(node)) found.push(node);
  for (const child of node.childNodes ?? []) found.push(...descendants(child, predicate));
  return found;
}
function text(node: Html): string {
  if (node.tagName === "script" || node.tagName === "style") return "";
  return ((node.value ?? "") + (node.childNodes ?? []).map(text).join(" "))
    .replace(/\s+/g, " ")
    .trim();
}
function tags(node: Html, tag: string): Html[] {
  return descendants(node, (n) => n.tagName === tag);
}
function attr(node: Html, key: string): string | undefined {
  return node.attrs?.find((a) => a.name === key)?.value;
}
function plain(value: string): string {
  return value.replace(/\*\*|`/g, "").trim();
}
function markdownTable(markdown: string, heading: string, headers: string[]): string[][] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(
    (line) =>
      /^#{1,6} /.test(line) && line.replace(/^#{1,6} /, "").replace(/ \[#.*\]$/, "") === heading,
  );
  if (start < 0) throw new Error(`Missing heading: ${heading}`);
  const section = lines.slice(start + 1);
  const end = section.findIndex((line) => /^#{1,6} /.test(line));
  const relevant = end < 0 ? section : section.slice(0, end);
  const tableStart = relevant.findIndex((line) => line.startsWith("|"));
  if (tableStart < 0) throw new Error(`Missing table: ${heading}`);
  const rows: string[][] = [];
  for (const line of relevant.slice(tableStart)) {
    if (!line.startsWith("|")) break;
    rows.push(
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  }
  if (JSON.stringify(rows[0]?.map(plain)) !== JSON.stringify(headers))
    throw new Error(`Changed table header: ${heading}`);
  if (rows.length < 3 || rows.slice(2).some((row) => row.length !== headers.length))
    throw new Error(`Malformed or empty table: ${heading}`);
  return rows.slice(2);
}
function row(
  id: string,
  plans: string[],
  status: Extracted["status"],
  evidence: Evidence[],
  conditions?: Record<string, Json>,
  api?: Record<string, string>,
): Extracted {
  return {
    id,
    plans: unique(plans),
    status,
    evidence,
    ...(conditions ? { conditions } : {}),
    ...(api ? { api } : {}),
  };
}
function kenari(bodies: Record<string, string>): Extracted[] {
  const plans = array(json(bodies, urls.kenariPlans)).map(object);
  const items = array(object(json(bodies, urls.kenariPricing)).items).map(object);
  const pricing = new Map(items.map((item) => [string(item.model), item]));
  if (
    new Set(plans.map((plan) => string(plan.id))).size !== plans.length ||
    new Set(plans.map((plan) => string(plan.name))).size !== plans.length
  )
    throw new Error("Duplicate plan identity");
  const docs = text(root(source(bodies, urls.kenariDocs)));
  requireText(docs, "Paket hanya menanggung chat.");
  requireText(docs, "Request ke model lain ditagih ke saldo");
  const found = new Map<
    string,
    {
      plans: string[];
      evidence: Evidence[];
      quotas: Record<string, Json>;
    }
  >();
  for (const [i, plan] of plans.entries()) {
    const name = string(plan.name);
    const id = string(plan.id);
    for (const [k, native] of strings(plan.scope_models).entries()) {
      const item = found.get(native) ?? { plans: [], evidence: [], quotas: {} };
      item.plans.push(name);
      item.evidence.push({
        url: urls.kenariPlans,
        locator: `$[${i}].scope_models[${k}]; plan.id=${id}`,
      });
      item.quotas[name] = {
        plan_id: id,
        budget_5h_micro_idr: Number(plan.budget_5h_micro_idr),
        budget_week_micro_idr: Number(plan.budget_week_micro_idr),
        budget_month_micro_idr: Number(plan.budget_month_micro_idr),
        free_cache: strings(plan.free_cache_models).includes(native),
      };
      found.set(native, item);
    }
  }
  return [...found.entries()].map(([id, value]) => {
    const metadata = pricing.get(id);
    const endpoints = metadata ? strings(metadata.endpoints) : [];
    return row(
      id,
      value.plans,
      metadata && endpoints.includes("chat") ? "available" : "unknown",
      [
        ...value.evidence,
        {
          url: urls.kenariDocs,
          locator: "Model tercakup; Endpoint yang tidak pernah ditanggung paket",
        },
        ...(metadata ? [{ url: urls.kenariPricing, locator: `$.items[model=${id}]` }] : []),
      ],
      {
        route_ids: ["kenari-api", "kenari-claude-code"],
        quota: value.quotas,
        endpoint_scope: "chat",
        pricing_metadata_present: Boolean(metadata),
        successor: typeof metadata?.successor === "string" ? metadata.successor : null,
        separately_billed_fallback_requires_user_choice: true,
      },
    );
  });
}
function minimax(subscriptionId: string, bodies: Record<string, string>): Extracted[] {
  const cn = subscriptionId.endsWith("-cn");
  const base = `https://platform.minimax.${cn ? "cn" : "io"}/docs/m-plan/`;
  const url = `${base}intro.md`;
  const toolsUrl = `${base}other-tools.md`;
  const intro = source(bodies, url);
  const tools = source(bodies, toolsUrl);
  const heading = cn ? "可用模型" : "Available models";
  const lines = intro.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line === `## ${heading}`);
  if (headingIndex < 0) throw new Error("Missing MiniMax model matrix");
  const matrixPart = lines.slice(headingIndex + 1).join("\n");
  const matrixLines = matrixPart.split(/\r?\n/).filter((line) => line.startsWith("|"));
  const headers = matrixLines[0]
    ?.split("|")
    .slice(1, -1)
    .map((s) => s.trim());
  if (!headers || headers[0] !== (cn ? "模型" : "Model")) throw new Error("Changed MiniMax header");
  const plans = headers.slice(1);
  const table = markdownTable(intro, heading, headers);
  const modelRow = table.find((cells) => cells[0] === (cn ? "文本模型" : "Text model"));
  if (!modelRow) throw new Error("Missing text membership row");
  const idMatches = [...tools.matchAll(/\| \*\*Model ID\*\* \| `([^`]+)` \|/g)].map((match) =>
    string(match[1]),
  );
  const nativeIds = unique(idMatches);
  if (nativeIds.length !== 1) throw new Error("Ambiguous native text ID");
  const native = string(nativeIds[0]);
  const label = native.replace(/^MiniMax-/, "").replace(/-/g, " ");
  if (modelRow.slice(1).some((cell) => (cn ? cell.replace(/^可用 /, "") : cell) !== label))
    throw new Error("Text matrix label differs from exact native identifier");
  const media: Record<string, Json> = {};
  for (const cells of table.filter((cells) => cells !== modelRow))
    media[plain(requiredValue(cells[0]))] = Object.fromEntries(
      plans.map((plan, i) => [plan, plain(requiredValue(cells[i + 1]))]),
    );
  return [
    row(
      native,
      plans,
      "available",
      [
        { url, locator: `${heading} table; row=${modelRow[0]}` },
        { url: toolsUrl, locator: "Connection table; Model ID" },
      ],
      {
        route_ids: [cn ? "minimax-m-plan-api-cn" : "minimax-m-plan-api"],
        region: cn ? "cn" : "global",
        media_matrix_display_only: media,
        scope: "text",
        media_native_identifiers_unresolved: true,
      },
      {
        "openai-chat-completions": `https://api.minimax.${cn ? "cn" : "io"}/v1`,
        "anthropic-messages": `https://api.minimax.${cn ? "cn" : "io"}/anthropic`,
      },
    ),
  ];
}
function moneo(bodies: Record<string, string>): Extracted[] {
  const catalog = array(object(json(bodies, urls.moneoModels)).data).map(object);
  const plans = array(object(json(bodies, urls.moneoPlans)).tariffs).map(object);
  const scope = text(root(source(bodies, urls.moneoScope)));
  requireText(scope, "общий лимит подписки и баланс");
  requireText(scope, "дорогой модели");
  const names = plans.map((plan) => string(plan.code));
  return catalog
    .filter((item) => item.availability !== "coming_soon")
    .map((item) => {
      const id = string(item.id);
      const availability = string(item.availability);
      const status =
        availability === "available"
          ? "available"
          : availability === "temporary_unavailable"
            ? "unavailable"
            : "unknown";
      return row(
        id,
        names,
        status,
        [
          { url: urls.moneoModels, locator: `$.data[id=${id}]` },
          { url: urls.moneoPlans, locator: "$.tariffs[*].code" },
          { url: urls.moneoScope, locator: "How subscription works; shared allowance and balance" },
        ],
        {
          route_ids: ["moneo-api-key"],
          availability,
          tariffs: plans.map((plan) => ({
            code: string(plan.code),
            label: string(plan.label),
            usd: string(plan.usd),
            multiplier: string(plan.multiplier),
            budget_usd: string(plan.budget_usd),
          })),
        },
        { "openai-chat-completions": "https://api.moneo.one/v1" },
      );
    });
}
function unbiased(bodies: Record<string, string>): Extracted[] {
  const schema = object(object(object(json(bodies, urls.unbiasedSchema)).components).schemas);
  const model = object(schema.Model);
  const native = string(model.const);
  const doc = root(source(bodies, urls.unbiasedPlans));
  const section = descendants(doc, (node) => attr(node, "id") === "plans")[0];
  if (!section) throw new Error("Missing plans section");
  const cards = tags(section, "article");
  const plans = cards
    .filter((card) => /\$[\d,.]+\s*\/\s*month/.test(text(card)))
    .map((card) => {
      const heading = tags(card, "h3")[0];
      if (!heading) throw new Error("Missing plan heading");
      return text(heading);
    });
  if (plans.length < 1) throw new Error("No monthly plans");
  const setup = descendants(doc, (node) => attr(node, "id") === "setup")[0];
  if (!setup || !text(setup).includes(native)) throw new Error("Model not bound to pricing setup");
  return [
    row(
      native,
      plans,
      "available",
      [
        { url: urls.unbiasedSchema, locator: "$.components.schemas.Model.const" },
        {
          url: urls.unbiasedPlans,
          locator: "#plans monthly-priced article headings; #setup model string",
        },
      ],
      {
        route_ids: ["api"],
        personal_use: true,
        production_use_requires_separate_written_agreement: true,
        account_approval_required: true,
      },
      {
        "openai-chat-completions": "https://api.unbiased.ai/v1",
        "anthropic-messages": "https://api.unbiased.ai",
      },
    ),
  ];
}
function berget(bodies: Record<string, string>): Extracted[] {
  const catalog = array(object(json(bodies, urls.bergetModels)).data).map(object);
  const pricing = root(source(bodies, urls.bergetPlans));
  const section = tags(pricing, "section").find((section) =>
    tags(section, "h2").some((h) => text(h) === "Serverless Inference"),
  );
  if (!section) throw new Error("Missing serverless section");
  const scope = text(section);
  requireText(scope, "Plans include pre-paid tokens");
  const plans = tags(section, "h3")
    .filter((heading) => {
      const parent = descendants(section, (node) => (node.childNodes ?? []).includes(heading))[0];
      return parent ? !/€0\s*\/\s*month/.test(text(parent)) : false;
    })
    .map(text);
  if (!plans.length) throw new Error("No paid serverless plan names");
  return catalog.map((item) => {
    const id = string(item.id);
    const lifecycle = string(item.lifecycle_status);
    const status =
      lifecycle === "retired"
        ? "unavailable"
        : lifecycle === "active" || lifecycle === "deprecated" || lifecycle === "preview"
          ? "available"
          : "unknown";
    return row(
      id,
      plans,
      status,
      [
        { url: urls.bergetModels, locator: `$.data[id=${id}]` },
        {
          url: urls.bergetPlans,
          locator: "Serverless Inference paid plan cards; prepaid token scope",
        },
      ],
      {
        route_ids: item.model_type === "text" ? ["serverless"] : [],
        model_type: string(item.model_type),
        chat_protocol_qualified: item.model_type === "text",
        lifecycle_status: lifecycle,
        aliases: strings(item.aliases ?? []),
        excludes_code_seat_entitlements: true,
      },
      item.model_type === "text"
        ? { "openai-chat-completions": "https://api.berget.ai/v1" }
        : undefined,
    );
  });
}
function abliteration(bodies: Record<string, string>): Extracted[] {
  const md = source(bodies, urls.ablitModels);
  const rates = source(bodies, urls.ablitRates);
  requireText(rates, "single prepaid balance that works across every model");
  requireText(rates, "Monthly subscriptions");
  const pricing = root(source(bodies, urls.ablitPlans));
  const headings = descendants(pricing, (node) => node.tagName === "h2" || node.tagName === "h3");
  const start = headings.findIndex((h) => text(h) === "Monthly plans");
  if (start < 0) throw new Error("Missing monthly plans heading");
  const plans: string[] = [];
  for (const h of headings.slice(start + 1)) {
    if (h.tagName === "h2") break;
    if (h.tagName === "h3") plans.push(text(h));
  }
  if (!plans.length) throw new Error("Empty monthly plans");
  const table = markdownTable(md, "Compare models", ["Model", "Input", "Context", "Max output"]);
  return table.map((cells) => {
    const match = cells[0]?.match(/abliterated-model(?:-[a-z0-9]+)*/);
    if (!match) throw new Error("Missing native model ID");
    const id = match[0];
    return row(
      id,
      plans,
      "available",
      [
        { url: urls.ablitModels, locator: `Compare models table; Model=${id}` },
        { url: urls.ablitRates, locator: "Billing and balance; Subscriptions and credit packs" },
        { url: urls.ablitPlans, locator: "Monthly plans h3 headings" },
      ],
      {
        route_ids: ["abliteration-api"],
        deprecated_existing_integrations_only: requiredValue(cells[0]).includes("!"),
        input: requiredValue(cells[1]),
        context: requiredValue(cells[2]),
        max_output: requiredValue(cells[3]),
      },
      { "openai-chat-completions": "https://api.abliteration.ai/v1" },
    );
  });
}
function frogbot(bodies: Record<string, string>): Extracted[] {
  const md = source(bodies, urls.frogbotModels);
  const billing = source(bodies, urls.frogbotScope);
  requireText(billing, "subscription payments and added funds become a USD balance");
  requireText(billing, "across supported models");
  const sections = md.split(/^## /m).slice(1);
  const output: Extracted[] = [];
  for (const section of sections) {
    const lines = section.split(/\r?\n/);
    const heading = requiredValue(lines[0]);
    if (!heading.toLowerCase().endsWith("models")) continue;
    const firstTable = lines.findIndex((line) => line.startsWith("|"));
    if (firstTable < 0) throw new Error("Missing model table");
    const header = requiredValue(lines[firstTable])
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (header[0] !== "Model ID") throw new Error("Changed model table");
    for (const line of lines.slice(firstTable + 2)) {
      if (!line.startsWith("|")) break;
      const cell = line.split("|")[1]?.trim();
      const match = cell?.match(/^`([^`]+)`$/);
      if (!match) throw new Error("Malformed native ID");
      output.push(
        row(
          string(match[1]),
          [],
          "unknown",
          [
            { url: urls.frogbotModels, locator: `${heading} table; Model ID=${match[1]}` },
            {
              url: urls.frogbotScope,
              locator: "Shared subscription invoice balance across supported models",
            },
          ],
          {
            route_ids: ["direct-model-subscription"],
            endpoint_family: heading,
            plan_names_unresolved: true,
            shared_subscription_balance_documented: true,
          },
        ),
      );
    }
  }
  return output;
}
export function extract(subscriptionId: string, bodies: Record<string, string>): Extracted[] {
  let rows: Extracted[];
  switch (subscriptionId) {
    case "kenari-plans":
      rows = kenari(bodies);
      break;
    case "minimax-m-plan":
    case "minimax-m-plan-cn":
      rows = minimax(subscriptionId, bodies);
      break;
    case "moneo-subscription":
      rows = moneo(bodies);
      break;
    case "unbiased":
      rows = unbiased(bodies);
      break;
    case "berget":
      rows = berget(bodies);
      break;
    case "abliteration-ai-monthly-plans":
      rows = abliteration(bodies);
      break;
    case "frogbot-subscription":
      rows = frogbot(bodies);
      break;
    case "sakana-subscription":
      rows = sakana(bodies);
      break;
    case "zeldoc":
      rows = zeldoc(bodies);
      break;
    case "sarvam-credit-plans":
      rows = sarvam(bodies);
      break;
    default:
      throw new Error(`No qualified public source for ${subscriptionId}`);
  }
  const ids = new Set<string>();
  for (const item of rows) {
    if (ids.has(item.id)) throw new Error(`Duplicate extracted model ID: ${item.id}`);
    ids.add(item.id);
    if (!item.evidence.length) throw new Error("Missing extraction evidence");
  }
  if (!rows.length) throw new Error("Empty extraction result");
  return rows;
}
