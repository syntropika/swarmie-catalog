import { type DefaultTreeAdapterMap, parse } from "parse5";
import type { ExtractedRow } from "./plan-tables.ts";
import { requiredValue } from "./validation.ts";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
export const sourceUrls = {
  "hyper-subscription": [
    "https://hyper.charm.land/v1/models",
    "https://hyper.charm.land/docs/plans-billing.html",
  ],
  "standardcompute-plans": [
    "https://api.stdcmpt.com/v1/models",
    "https://docs.standardcompute.com/models",
    "https://docs.standardcompute.com/budgets-and-limits",
  ],
  neuralwatt: ["https://api.neuralwatt.com/v1/models", "https://portal.neuralwatt.com/pricing"],
  "cline-pass": ["https://docs.cline.bot/getting-started/clinepass"],
  "zai-coding-plan": [
    "https://docs.z.ai/devpack/overview",
    "https://docs.z.ai/guides/llm/glm-5.3.md",
    "https://docs.z.ai/guides/vlm/glm-5.3-flash.md",
  ],
  "glm-coding-plan-cn": [
    "https://docs.bigmodel.cn/cn/coding-plan/overview",
    "https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3.md",
    "https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash.md",
  ],
  "privatemode-business": [
    "https://docs.privatemode.ai/models/overview",
    "https://www.privatemode.ai/pricing",
  ],
} as const;
function requireCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function body(bodies: Record<string, string>, url: string): string {
  const value = bodies[url];
  requireCondition(typeof value === "string" && value.length > 0, `Missing source: ${url}`);
  return value;
}
function attr(node: Element, key: string): string | undefined {
  return node.attrs.find((entry) => entry.name === key)?.value;
}
function children(node: Node): Node[] {
  return "childNodes" in node ? node.childNodes : [];
}
function elements(node: Node, predicate: (element: Element) => boolean): Element[] {
  const found: Element[] = [];
  function visit(current: Node): void {
    if ("tagName" in current) {
      if (current.tagName === "script" || current.tagName === "style") return;
      if (predicate(current)) found.push(current);
    }
    for (const child of children(current)) visit(child);
  }
  visit(node);
  return found;
}
function rawText(node: Node): string {
  if ("value" in node) return node.value;
  if ("tagName" in node && (node.tagName === "script" || node.tagName === "style")) return "";
  return children(node).map(rawText).join(" ");
}
function text(node: Node): string {
  return rawText(node).replace(/\s+/g, " ").trim();
}
function exactlyOne<T>(items: T[], description: string): T {
  requireCondition(items.length === 1, `Expected one ${description}, received ${items.length}`);
  return requiredValue(items[0]);
}
function unique(values: string[], description: string): string[] {
  requireCondition(
    values.length > 0 && values.every((value) => value.length > 0),
    `Empty ${description}`,
  );
  requireCondition(new Set(values).size === values.length, `Duplicate ${description}`);
  return values;
}
function rows(table: Element): Element[][] {
  return elements(table, (element) => element.tagName === "tr").map((row) =>
    children(row).filter(
      (child): child is Element => "tagName" in child && ["th", "td"].includes(child.tagName),
    ),
  );
}
function tableWithHeader(doc: Node, expected: string[]): Element {
  return exactlyOne(
    elements(doc, (element) => element.tagName === "table").filter((table) => {
      const header = rows(table)[0]?.map(text);
      return (
        header?.length === expected.length &&
        header.every((cell, index) => cell === expected[index])
      );
    }),
    `table with headers ${expected.join("/")}`,
  );
}
function evidence(
  url: string,
  locator: string,
): {
  url: string;
  locator: string;
}[] {
  return [{ url, locator }];
}
function object(value: unknown, description: string): Record<string, unknown> {
  requireCondition(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `Invalid ${description}`,
  );
  return value as Record<string, unknown>;
}
function string(value: unknown, description: string): string {
  requireCondition(typeof value === "string" && value.length > 0, `Invalid ${description}`);
  return value;
}
function array(value: unknown, description: string): unknown[] {
  requireCondition(Array.isArray(value) && value.length > 0, `Invalid ${description}`);
  return value;
}
function catalog(bodies: Record<string, string>, url: string): Record<string, unknown>[] {
  const root = object(globalThis.JSON.parse(body(bodies, url)), "model catalog");
  requireCondition(root.object === "list", "Model catalog list contract changed");
  return array(root.data, "model catalog data").map((value) => object(value, "model catalog row"));
}
function hyper(bodies: Record<string, string>): ExtractedRow[] {
  const [modelUrl, planUrl] = sourceUrls["hyper-subscription"];
  const planDoc = parse(body(bodies, planUrl));
  requireCondition(
    text(planDoc).includes("Every plan includes all available models and the Prism routing model"),
    "Hyper all-plan membership rule changed",
  );
  const planTables = elements(planDoc, (node) => node.tagName === "table").filter(
    (table) =>
      rows(table)[0]?.map(text).join("|") ===
      "Plan|Price|Hypercredits / week|Inference / week|Hypercredits / 5 hours|Concurrent requests",
  );
  requireCondition(planTables.length === 2, "Hyper personal/team plan table structure changed");
  const planRows = planTables.flatMap((table) => rows(table).slice(1));
  const plans = unique(
    planRows.map((row) => text(requiredValue(row[0]))),
    "Hyper named plans",
  );
  return catalog(bodies, modelUrl).map((row) => ({
    id: string(row.id, "Hyper native ID"),
    plans,
    status: "available",
    conditions: {
      scope: "all-named-personal-and-team-plans",
      training_policy: "personal-plans-not-zero-retention",
      quota: "weekly-credit-and-five-hour-window",
      fallback_billing: "prepaid-credit-after-subscription-exhaustion",
    },
    evidence: [
      ...evidence(modelUrl, `$.data[id=${row.id}]`),
      ...evidence(planUrl, "Available Plans all-model rule; Personal and Team tables"),
    ],
  }));
}
function standard(bodies: Record<string, string>): ExtractedRow[] {
  const [modelUrl, scopeUrl, planUrl] = sourceUrls["standardcompute-plans"];
  const scope = text(parse(body(bodies, scopeUrl)));
  requireCondition(
    /Every paid plan, from Starter at \$19, can use every model\./.test(scope),
    "StandardCompute all-paid-plan rule changed",
  );
  const doc = parse(body(bodies, planUrl));
  const table = tableWithHeader(doc, ["Plan", "Price per month", "Monthly compute budget"]);
  const plans = rows(table)
    .slice(1)
    .map((row) => {
      requireCondition(
        row.length === 3 && /^\$[\d,]+$/.test(text(requiredValue(row[1]))),
        "StandardCompute paid tier shape changed",
      );
      return text(requiredValue(row[0]));
    });
  const enterprise = /\b(Enterprise) \(\$[\d,]+\/month\) adds every Enterprise feature/.exec(
    text(doc),
  );
  requireCondition(enterprise, "StandardCompute Enterprise priced-plan scope changed");
  plans.push(requiredValue(enterprise[1]));
  unique(plans, "StandardCompute paid plans");
  const requestAlias = /Send ([A-Za-z0-9._/-]+) as the model/.exec(scope)?.[1];
  const responseAlias = /response's model field is ([A-Za-z0-9._/-]+)/.exec(scope)?.[1];
  requireCondition(
    requestAlias && responseAlias,
    "StandardCompute documented routing identity changed",
  );
  return catalog(bodies, modelUrl).map((row) => ({
    id: string(row.id, "StandardCompute native ID"),
    plans,
    status: row.id === responseAlias && responseAlias !== requestAlias ? "unknown" : "available",
    conditions: {
      quota: "fixed-monthly-compute-budget",
      trial_membership: "unknown",
      teams: "free-wrapper-with-per-key-paid-plans",
      overflow: "optional-usage-billing",
      ...(row.id === responseAlias
        ? {
            documented_request_alias: requestAlias,
            request_case_binding: "catalog-response-id-differs-from-documented-request-alias",
          }
        : {}),
    },
    evidence: [
      ...evidence(modelUrl, `$.data[id=${row.id}]`),
      ...evidence(scopeUrl, "Every paid plan can use every model"),
      ...evidence(planUrl, "Plans table and priced Enterprise paragraph"),
    ],
  }));
}
function neural(bodies: Record<string, string>): ExtractedRow[] {
  const [modelUrl, planUrl] = sourceUrls.neuralwatt;
  const raw = object(globalThis.JSON.parse(body(bodies, modelUrl)), "Neuralwatt catalog");
  requireCondition(raw.scope === "public", "Neuralwatt anonymous scope changed");
  const doc = parse(body(bodies, planUrl));
  const payg = exactlyOne(
    elements(doc, (node) => attr(node, "data-matrix-cell") === "includes:payg"),
    "Neuralwatt base model scope",
  );
  requireCondition(text(payg).startsWith("All models."), "Neuralwatt all-model PAYG scope changed");
  const planHeaders = elements(
    doc,
    (node) =>
      node.tagName === "th" &&
      attr(node, "data-matrix-col") !== undefined &&
      attr(node, "data-matrix-col") !== "payg",
  );
  const plans = unique(
    planHeaders.map((header, index) => {
      const key = requiredValue(attr(header, "data-matrix-col"));
      const name = text(
        exactlyOne(
          elements(
            header,
            (node) =>
              node.tagName === "span" &&
              (attr(node, "class") ?? "").split(/\s+/).includes("text-lg"),
          ),
          "Neuralwatt tier name",
        ),
      );
      const includes = exactlyOne(
        elements(doc, (node) => attr(node, "data-matrix-cell") === `includes:${key}`),
        "Neuralwatt inheritance cell",
      );
      const predecessor =
        index === 0
          ? "pay as you go"
          : text(
              exactlyOne(
                elements(
                  requiredValue(planHeaders[index - 1]),
                  (node) =>
                    node.tagName === "span" &&
                    (attr(node, "class") ?? "").split(/\s+/).includes("text-lg"),
                ),
                "Neuralwatt predecessor name",
              ),
            );
      requireCondition(
        text(includes).startsWith(`Everything in ${predecessor}`),
        "Neuralwatt paid-plan inheritance changed",
      );
      requireCondition(
        elements(header, (node) => (attr(node, "aria-label") ?? "").includes("outside speed lanes"))
          .length === 1,
        "Neuralwatt subscription allowance scope changed",
      );
      return name;
    }),
    "Neuralwatt paid plans",
  );
  const laneBlock = exactlyOne(
    elements(doc, (node) => attr(node, "data-speed-lanes-block") !== undefined),
    "Neuralwatt speed lane block",
  );
  const lanes = unique(
    elements(laneBlock, (node) => attr(node, "data-speed-lane-row") !== undefined).map((node) => {
      const id = requiredValue(attr(node, "data-speed-lane-row"));
      requireCondition(
        text(
          exactlyOne(
            elements(node, (child) => child.tagName === "code"),
            "Neuralwatt exact speed lane ID",
          ),
        ) === id,
        "Neuralwatt speed-lane attribute/code identity differs",
      );
      return id;
    }),
    "Neuralwatt explicit speed lane IDs",
  );
  return catalog(bodies, modelUrl).map((row) => {
    const id = string(row.id, "Neuralwatt native ID");
    const metadata = object(row.metadata, "Neuralwatt metadata");
    const pricing = object(metadata.pricing, "Neuralwatt pricing");
    const lane = lanes.includes(id);
    const architecture = object(row.architecture, "Neuralwatt architecture");
    const outputs = array(architecture.output_modalities, "Neuralwatt output modalities").map(
      (value) => string(value, "output modality"),
    );
    requireCondition(
      typeof metadata.deprecated === "boolean",
      "Neuralwatt deprecation marker absent",
    );
    const status = lane || metadata.deprecated ? "unavailable" : "available";
    return {
      id,
      plans,
      status,
      conditions: {
        output_modalities: outputs,
        catalog_scope: "public",
        speed_lane: lane,
        deprecated: metadata.deprecated,
        service_tier: string(pricing.service_tier, "Neuralwatt service tier"),
        quota: "monthly-energy-pool",
        overage: "billed-at-plan-kwh-rate",
        account_granted_models: "not-publicly-enumerated",
      },
      evidence: [
        ...evidence(modelUrl, `$.data[id=${id}]; $.scope=public`),
        ...evidence(
          planUrl,
          `includes inheritance cells; header allowance labels outside speed lanes; data-speed-lane-row=${id}`,
        ),
      ],
    };
  });
}
function cline(bodies: Record<string, string>): ExtractedRow[] {
  const [url] = sourceUrls["cline-pass"];
  const doc = parse(body(bodies, url));
  const page = text(doc);
  const plan = text(
    exactlyOne(
      elements(doc, (node) => node.tagName === "h1"),
      "ClinePass title",
    ),
  );
  requireCondition(
    plan === "ClinePass" &&
      page.includes(
        "ClinePass includes the following models, tested and benchmarked for coding agent use",
      ),
    "ClinePass inclusion statement changed",
  );
  const table = tableWithHeader(doc, ["Model", "Model ID"]);
  return rows(table)
    .slice(1)
    .map((row) => {
      requireCondition(row.length === 2, "ClinePass model row shape changed");
      const id = text(
        exactlyOne(
          elements(requiredValue(row[1]), (node) => node.tagName === "code"),
          "ClinePass request ID",
        ),
      );
      requireCondition(
        /^cline-pass\/[A-Za-z0-9._/-]+$/.test(id),
        "ClinePass native namespace changed",
      );
      return {
        id,
        plans: [plan],
        status: "available",
        conditions: {
          source_model_name: text(requiredValue(row[0])),
          scope: "cline-pass-subscription",
          response_header: "X-Response-Format: openai",
          quota: "five-hour-weekly-monthly-limits",
          completeness: "documented-model-list",
        },
        evidence: evidence(url, `Models table: Model ID=${id}; preceding inclusion statement`),
      };
    });
}
function modelNames(value: string): string[] {
  return unique(
    (value.replace(/\u2011/g, "-").match(/GLM-[A-Za-z0-9.-]+/g) ?? []).map((name) =>
      name.replace(/\.$/, ""),
    ),
    "GLM supported display names",
  );
}
function glm(bodies: Record<string, string>, china: boolean): ExtractedRow[] {
  const urls = china ? sourceUrls["glm-coding-plan-cn"] : sourceUrls["zai-coding-plan"];
  const [overview] = urls;
  const doc = parse(body(bodies, overview));
  const prefix = china ? "所有套餐均支持" : "All plans support GLM-";
  const statement = exactlyOne(
    elements(
      doc,
      (node) => ["li", "p"].includes(node.tagName) && text(node).startsWith(prefix),
    ).filter(
      (node, _, all) =>
        !all.some(
          (other) => other !== node && elements(node, (child) => child === other).length > 0,
        ),
    ),
    "GLM all-plan model statement",
  );
  const names = modelNames(text(statement));
  const planTable = tableWithHeader(
    doc,
    china
      ? ["套餐类型", "5 小时积分", "每周积分"]
      : ["Plan Type", "5-Hour Credits", "Weekly Credits"],
  );
  const plans = unique(
    rows(planTable)
      .slice(1)
      .map((row) => text(requiredValue(row[0])).replace(/ 套餐$/, "")),
    "GLM paid plans",
  );
  const deduction = tableWithHeader(
    doc,
    china
      ? ["产品类型", "产品名称", "Input 抵扣系数", "Cached Input 抵扣系数", "Output 抵扣系数"]
      : [
          "Product Type",
          "Product",
          "Input Multiplier",
          "Cached Input Multiplier",
          "Output Multiplier",
        ],
  );
  const productNames = rows(deduction)
    .slice(1)
    .map((row) => text(requiredValue(row[row.length === 5 ? 1 : 0])));
  return names.map((name) => {
    requireCondition(
      productNames.some(
        (product) =>
          product.replace(/\u2011/g, "-").startsWith(name) &&
          /^\s*(?:\(|（|$)/.test(product.replace(/\u2011/g, "-").slice(name.length)),
      ),
      "GLM inclusion absent from credit deduction table",
    );
    const candidates = urls
      .slice(1)
      .flatMap((url) => {
        const markdown = body(bodies, url);
        const requestIds = [...markdown.matchAll(/\bmodel["']?\s*(?:=|:)\s*["']([^"']+)["']/g)].map(
          (match) => requiredValue(match[1]),
        );
        const codeLine = markdown.split("\n").find((line) => line.includes("**Model Code**"));
        const explicitCodes = codeLine
          ? [...codeLine.matchAll(/`([^`]+)`/g)].map((match) => requiredValue(match[1]))
          : [];
        return [...requestIds, ...explicitCodes].map((id) => ({ id, url }));
      })
      .filter((candidate) => candidate.id.toUpperCase() === name.toUpperCase());
    const distinctIds = [...new Set(candidates.map((candidate) => candidate.id))];
    requireCondition(
      distinctIds.length === 1,
      "GLM native wire ID absent or ambiguous in official model-reference examples",
    );
    const id = requiredValue(distinctIds[0]);
    const nativeSource = requiredValue(candidates.find((candidate) => candidate.id === id));
    return {
      id,
      plans,
      status: "available",
      conditions: {
        scope: "officially-supported-tools-only",
        native_display_name: name,
        historical_model_routing: "legacy-model-requests-may-route-to-current-models",
        quota: "five-hour-and-weekly-credit-limits",
      },
      evidence: [
        ...evidence(
          overview,
          `All-plan supported models statement ${name}; credit deduction table; plan quota table`,
        ),
        ...evidence(nativeSource.url, `official request example model=${id}`),
      ],
    };
  });
}
function privateMode(bodies: Record<string, string>): ExtractedRow[] {
  const [url, planUrl] = sourceUrls["privatemode-business"];
  const doc = parse(body(bodies, url));
  const pricing = text(parse(body(bodies, planUrl)));
  requireCondition(
    pricing.includes("Everything in Pay-as-you-go, plus") &&
      pricing.includes("Your full fee becomes token budget") &&
      pricing.includes("All models for chat, embeddings, and speech-to-text"),
    "Privatemode Business inheritance rule changed",
  );
  const planDoc = parse(body(bodies, planUrl));
  const plan = text(
    exactlyOne(
      elements(planDoc, (node) => node.tagName === "h3" && text(node) === "Business"),
      "Privatemode priced Business heading",
    ),
  );
  const table = tableWithHeader(doc, [
    "Model",
    "Model ID",
    "Type",
    "Input",
    "Context / limit",
    "Endpoints",
  ]);
  return rows(table)
    .slice(1)
    .map((row) => {
      requireCondition(row.length === 6, "Privatemode model table row shape changed");
      const codes = elements(requiredValue(row[1]), (node) => node.tagName === "code").map(text);
      const id = codes[0];
      requireCondition(id && codes.length > 0, "Privatemode native ID missing");
      const type = text(requiredValue(row[2]));
      return {
        id,
        plans: [plan],
        status: "unknown",
        conditions: {
          model_type: type,
          aliases: codes.slice(1),
          preview: text(requiredValue(row[0])).includes("(preview)"),
          membership_scope: ["Chat", "Embeddings", "Speech-to-text"].includes(type)
            ? "business-model-type-inheritance"
            : "not-explicitly-included-type",
          subscription_api_funding: "unqualified-public-binding",
          billing_docs: "organization-billing-docs-do-not-name-business-token-budget",
          local_proxy_or_attestation_sdk: "supported-client-path; no coding-agent-runtime implied",
        },
        evidence: [
          ...evidence(url, `Models table Model ID=${id}; Type=${type}`),
          ...evidence(
            planUrl,
            "Business inherited capabilities and full-fee token budget; route funding not explicit",
          ),
        ],
      };
    });
}
export function extract(subscriptionId: string, bodies: Record<string, string>): ExtractedRow[] {
  let output: ExtractedRow[];
  switch (subscriptionId) {
    case "hyper-subscription":
      output = hyper(bodies);
      break;
    case "standardcompute-plans":
      output = standard(bodies);
      break;
    case "neuralwatt":
      output = neural(bodies);
      break;
    case "cline-pass":
      output = cline(bodies);
      break;
    case "zai-coding-plan":
      output = glm(bodies, false);
      break;
    case "glm-coding-plan-cn":
      output = glm(bodies, true);
      break;
    case "privatemode-business":
      output = privateMode(bodies);
      break;
    default:
      throw new Error(`Unsupported public source: ${subscriptionId}`);
  }
  unique(
    output.map((row) => row.id),
    "native IDs",
  );
  return output.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
