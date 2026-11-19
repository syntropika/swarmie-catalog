import { assertCondition, sourceParsers as p, type Row } from "./region-plans.ts";

type Bodies = Record<string, string>;
export const sourceManifest: Record<string, string[]> = {
  "tencent-coding-plan": ["https://cloud.tencent.com/document/product/1823/130092"],
  "tencent-token-plan": ["https://cloud.tencent.com/document/product/1823/130060"],
  "tencent-tokenhub-plans": [
    "https://cloud.tencent.com/document/product/1823/130060",
    "https://cloud.tencent.com/document/product/1823/130092",
  ],
  "kuae-coding-plan": [
    "https://docs.mthreads.com/kuaecloud/kuaecloud-doc-online/coding_plan/plan_overview/",
    "https://docs.mthreads.com/kuaecloud/kuaecloud-doc-online/coding_plan/tools_config/",
  ],
  "nano-gpt-pro": [
    "https://api.nano-gpt.com/api/subscription/v1/models?detailed=true",
    "https://docs.nano-gpt.com/api-reference/endpoint/models",
    "https://nano-gpt.com/pricing",
    "https://api.nano-gpt.com/api/paid/v1/models?detailed=true",
  ],
  "huggingface-pro-inference-credits": [
    "https://router.huggingface.co/v1/models",
    "https://huggingface.co/docs/inference-providers/pricing",
  ],
  "venice-paid-plans": [
    "https://api.venice.ai/api/v1/models?type=all",
    "https://docs.venice.ai/pricing.md",
  ],
  sparrowcodes: [
    "https://api.sparrowcodes.com/v1/models",
    "https://sparrowcodes.com/pricing",
    "https://sparrowcodes.com/cli",
  ],
  anonrouter: [
    "https://control.anonrouter.ai/v1/catalog/models",
    "https://control.anonrouter.ai/v1/billing/catalog",
    "https://docs.anonrouter.ai/subscriptions",
  ],
  "poe-subscription": [
    "https://api.poe.com/v1/models",
    "https://creator.poe.com/docs/external-applications/openai-compatible-api",
  ],
  abacus: [
    "https://routellm.abacus.ai/v1/models",
    "https://abacus.ai/help/route-llm/",
    "https://routellm-apis.abacus.ai/faq",
    "https://abacus.ai/teams/hxi",
  ],
};
function inputs(id: string, bodies: Bodies): { urls: string[]; contents: string[] } {
  const urls = sourceManifest[id];
  assertCondition(urls, `Missing source manifest for ${id}`);
  return { urls, contents: urls.map((url) => p.required(bodies, url)) };
}
function data(source: string): Record<string, unknown>[] {
  const root = p.object(JSON.parse(source));
  assertCondition(root.object === "list", "Expected an OpenAI-style model list");
  const models = p.array(root.data).map(p.object);
  assertCondition(models.length > 0, "Empty model list");
  return models;
}
function nano(bodies: Bodies): Row[] {
  const { urls, contents } = inputs("nano-gpt-pro", bodies);
  const [catalog, docs, pricing, paidCatalog] = contents;
  assertCondition(catalog && docs && pricing, "Missing NanoGPT source bodies");
  const guide = p.text(p.dom(docs));
  assertCondition(
    guide.includes("Always returns only models included in the NanoGPT subscription") &&
      guide.includes("/api/subscription/v1/models"),
    "NanoGPT subscription-scoped list contract changed",
  );
  const root = p.dom(pricing);
  const prose = p.text(root);
  assertCondition(
    prose.includes("On the web and through the API") &&
      prose.includes("Paid models keep billing your balance"),
    "NanoGPT subscription billing scope changed",
  );
  const candidates = p
    .list(root)
    .filter(
      (node) =>
        p.text(node).trim() === "PRO" &&
        !(node.childNodes ?? []).some((child) => p.text(child).trim() === "PRO"),
    );
  assertCondition(candidates.length > 0, "Missing NanoGPT subscription plan name");
  const plans = [...new Set(candidates.map(p.text))];
  const ids = data(catalog).map((model) => p.string(model.id));
  assertCondition(paidCatalog, "Missing NanoGPT paid-only complement");
  const paidIds = new Set(data(paidCatalog).map((model) => p.string(model.id)));
  return p
    .grants(ids, plans, p.string(urls[0]), "data[].id; dedicated subscription-only endpoint", {
      scope: "subscription-included text models only",
      billing: "included input-token allowance; paid extras consume balance",
      provider_pinning: "separately billed; do not transfer inclusion to pinned-provider variants",
      other_modalities: "separate catalogs and allowances",
    })
    .map((row) => ({
      ...row,
      status: paidIds.has(row.id) ? "unknown" : row.status,
      conditions: { ...row.conditions, also_in_paid_catalog: paidIds.has(row.id) },
      evidence: [
        ...row.evidence,
        {
          url: p.string(urls[1]),
          locator: "Subscription-only endpoint always includes only NanoGPT subscription models",
        },
        { url: p.string(urls[2]), locator: "PRO allowance / API included / paid extras excluded" },
        {
          url: p.string(urls[3]),
          locator:
            "Paid-only complement cross-check; overlapping router IDs need scope clarification",
        },
      ],
    }));
}
function hf(bodies: Bodies): Row[] {
  const { urls, contents } = inputs("huggingface-pro-inference-credits", bodies);
  const [catalog, billing] = contents;
  assertCondition(catalog && billing, "Missing Hugging Face sources");
  const root = p.dom(billing);
  const rows = p
    .tables(root)
    .find(
      (rows) =>
        rows[0]?.join("|") ===
        "Account Type|Monthly Credits|Can be spent on|Extra usage (pay-as-you-go)",
    );
  assertCondition(rows, "Missing Hugging Face monthly-credit table");
  const covered = rows
    .slice(1)
    .filter(
      (cells) => cells[2] === "All Hugging Face compute services" && /\$/.test(cells[1] ?? ""),
    );
  const plans = covered.flatMap((cells) =>
    p
      .string(cells[0])
      .replace(/\s+(Users|Organizations)$/, "")
      .split(/\s+or\s+/),
  );
  assertCondition(
    p.text(root).includes("automatically apply when you route requests through Hugging Face"),
    "HF routed request credit scope changed",
  );
  const models = data(catalog);
  return p
    .grants(
      models.map((model) => p.string(model.id)),
      plans,
      p.string(urls[0]),
      "data[].id; providers[] owns live route availability",
      {
        scope: "HF-routed requests only",
        byok: "custom provider keys do not consume HF included credits",
        organization_billing: "explicit bill_to / X-HF-Bill-To required",
        allowance: "shared with other HF compute services",
        overage: "pay-as-you-go after included credits",
      },
    )
    .map((row, index) => {
      const providers = p.array(models[index]?.providers).map(p.object);
      const statuses = providers.map((provider) => ({
        provider: p.string(provider.provider),
        status: p.string(provider.status),
      }));
      const live = statuses.some((provider) => provider.status === "live");
      return {
        ...row,
        status: live ? "available" : "unknown",
        conditions: {
          ...row.conditions,
          source_provider_status: statuses,
          monthly_credit_table: covered.map((cells) => ({
            account_type: p.string(cells[0]),
            allowance: p.string(cells[1]),
          })),
        },
        evidence: [
          ...row.evidence,
          {
            url: p.string(urls[1]),
            locator:
              "Included Monthly Credits table; all compute services; automatic HF-routed application",
          },
        ],
      };
    });
}
function venice(bodies: Bodies): Row[] {
  const { urls, contents } = inputs("venice-paid-plans", bodies);
  const [catalog, billing] = contents;
  assertCondition(catalog && billing, "Missing Venice sources");
  const start = billing.indexOf("## Paying for usage");
  assertCondition(start >= 0, "Missing Venice bundled-credit section");
  const section = billing.slice(start);
  assertCondition(
    section.includes(
      "Venice charges each request to DIEM first, then earned credits, then bundled credits, then USD",
    ),
    "Venice per-request bundled-credit rule changed",
  );
  const allowance = /Paid plans include a monthly bundled-credit allowance:([^\n]+)/.exec(
    section,
  )?.[1];
  assertCondition(allowance, "Missing Venice monthly allowance declaration");
  const grants = [...allowance.matchAll(/\$(\d+(?:\.\d+)?)\s+on\s+([A-Za-z][A-Za-z0-9_-]*)/g)];
  assertCondition(grants.length > 0, "Missing source-derived Venice paid plans");
  const plans = grants.map((match) => p.string(match[2]));
  const allowanceByPlan = Object.fromEntries(
    grants.map((match) => [p.string(match[2]), Number(match[1])]),
  );
  const models = data(catalog);
  return p
    .grants(
      models.map((model) => p.string(model.id)),
      plans,
      p.string(urls[0]),
      "data[].id; type=all",
      {
        funding_order: "DIEM, earned credits, bundled credits, USD",
        monthly_usd_by_plan: allowanceByPlan,
        scope: "monetary API allowance; never unlimited use",
        transport: "preserve per-model modality and required endpoint",
      },
    )
    .map((row, index) => {
      const model = models[index];
      const spec = p.object(model?.model_spec);
      const beta = spec.betaModel === true || spec.beta === true;
      const offline = spec.offline === true || model?.offline === true;
      return {
        ...row,
        status: offline ? "unavailable" : beta ? "unknown" : "available",
        conditions: {
          ...row.conditions,
          beta,
          offline,
          model_type: typeof model?.type === "string" ? model.type : null,
          privacy: typeof spec.privacy === "string" ? spec.privacy : null,
        },
        evidence: [
          ...row.evidence,
          {
            url: p.string(urls[1]),
            locator: "Paying for usage: monthly bundled credits and per-request charge order",
          },
        ],
      };
    });
}
function sparrow(bodies: Bodies): Row[] {
  const { urls, contents } = inputs("sparrowcodes", bodies);
  const [catalog, pricing, cli] = contents;
  assertCondition(catalog && pricing && cli, "Missing SparrowCodes sources");
  const rows = p.tables(p.dom(pricing)).find((rows) => rows[0]?.join("|") === "Plan|Usage|Models");
  assertCondition(rows, "Missing SparrowCodes plan/model table");
  const paidPlans = rows
    .slice(1)
    .filter((cells) => cells[2] === "Every model")
    .map((cells) => p.string(cells[0]));
  assertCondition(
    p.text(p.dom(cli)).includes("A coding agent that picks the right model for each task"),
    "Missing native SparrowCodes agent scope",
  );
  const models = data(catalog);
  const selected = models.filter((model) => model.available === true && model.test === false);
  const result = p
    .grants(
      selected.map((model) => p.string(model.id)),
      paidPlans,
      p.string(urls[0]),
      "data[].id where available == true and test == false",
      {
        execution: "coding-agent",
        required_client: "SparrowCodes CLI",
        direct_api_billing: "pay-as-you-go; plan grants do not apply to arbitrary API calls",
        model_picker_prefix: "sparrowcodes/",
        privacy: "free models can retain request data",
      },
    )
    .map((row) => ({
      ...row,
      evidence: [
        ...row.evidence,
        { url: p.string(urls[1]), locator: "Plan / Usage / Models: Every model" },
        {
          url: p.string(urls[2]),
          locator: "Native coding-agent runtime and per-plan model picker",
        },
      ],
    }));
  const freePlan = rows.slice(1).find((cells) => cells[2] !== "Every model");
  if (freePlan) {
    const freeModels = selected.filter((model) => model.free !== undefined && model.free !== null);
    for (const model of freeModels)
      result.push(
        ...p.grants(
          [p.string(model.id)],
          [p.string(freePlan[0])],
          p.string(urls[0]),
          "Native free model has a free allowance object; Free plan names this free model",
          {
            execution: "coding-agent",
            required_client: "SparrowCodes CLI",
            allowance: p.string(freePlan[1]),
            free_router: "Auto-on-Free routing is not an independent model grant",
          },
        ),
      );
  }
  return result;
}
function anon(bodies: Bodies): Row[] {
  const { urls, contents } = inputs("anonrouter", bodies);
  const [catalog, billing, guide] = contents;
  assertCondition(catalog && billing && guide, "Missing AnonRouter sources");
  assertCondition(
    p.text(p.dom(guide)).includes("Every plan can use every model, endpoint and the API"),
    "AnonRouter all-plan scope changed",
  );
  const root = p.object(JSON.parse(catalog));
  assertCondition(
    root.object === "catalog" && root.schema_version === 1,
    "AnonRouter catalog schema changed",
  );
  assertCondition(
    root.stale === false && root.status === "healthy",
    `AnonRouter source is not healthy: stale=${root.stale}, status=${root.status}`,
  );
  const bill = p.object(JSON.parse(billing));
  const planRows = p.array(bill.subscription_plans).map(p.object);
  const plans = planRows.map((plan) => p.string(plan.code));
  const models = p.array(root.models).map(p.object);
  return p
    .grants(
      models.map((model) => p.string(model.id)),
      plans,
      p.string(urls[0]),
      "models[].id; healthy schema_version 1 catalog",
      {
        allowance: "monetary budget with rolling five-hour and seven-day caps",
        payg_fallback: "whole request can fall back to separate prepaid credits",
        new_subscriptions_enabled: bill.subscriptions_enabled === true,
      },
    )
    .map((row, index) => ({
      ...row,
      conditions: {
        ...row.conditions,
        subscription_plan_labels: planRows.map((plan) => ({
          code: p.string(plan.code),
          name: p.string(plan.name),
        })),
        discount_plan_keys: Object.keys(p.object(models[index]?.subscriberPricingByPlan ?? {})),
      },
      evidence: [
        ...row.evidence,
        { url: p.string(urls[1]), locator: "subscription_plans[].code/name" },
        {
          url: p.string(urls[2]),
          locator: "Every plan can use every model; route discounts do not limit membership",
        },
      ],
    }));
}
function poe(bodies: Bodies): Row[] {
  const { urls, contents } = inputs("poe-subscription", bodies);
  const [catalog, guide] = contents;
  assertCondition(catalog && guide, "Missing Poe sources");
  const prose = p.text(p.dom(guide));
  assertCondition(
    prose.includes(
      "All Poe subscribers can use their existing subscription points with the API at no additional cost",
    ) && prose.includes("Only public bots can be accessed through the API"),
    "Poe subscriber/public-bot scope changed",
  );
  // The prohibition comes from the owning documentation, not a maintained model list.
  const exclusion = /[^.\n]{0,180}bots are not available[^.\n]*/gi;
  const forbidden = new Set<string>();
  for (const match of prose.matchAll(exclusion))
    for (const id of match[0].match(/\b[A-Z][A-Za-z]+(?:-[A-Z][A-Za-z]+)+\b/g) ?? [])
      forbidden.add(id);
  return data(catalog)
    .filter((model) => !forbidden.has(p.string(model.id)))
    .map(
      (model): Row => ({
        id: p.string(model.id),
        plans: [],
        status: "unknown",
        conditions: {
          membership_scope: "all Poe subscribers, public bots only",
          blocker:
            "actual subscription tier labels are not verified; requires an all-subscriptions representation rather than invented plan IDs",
          funding: "subscription points at per-bot rates",
        },
        evidence: [
          { url: p.string(urls[0]), locator: "data[].id" },
          {
            url: p.string(urls[1]),
            locator: "All subscribers can spend points through API; public-bot scope",
          },
        ],
      }),
    );
}
function abacus(bodies: Bodies): Row[] {
  const { urls, contents } = inputs("abacus", bodies);
  const [catalog, guide, faq] = contents;
  assertCondition(catalog && guide && faq, "Missing Abacus sources");
  const prose = p.text(p.dom(guide));
  assertCondition(prose.includes("ChatLLM subscription"), "Missing RouteLLM subscription context");
  return p
    .array(p.object(JSON.parse(catalog)).data)
    .map(p.object)
    .map(
      (model): Row => ({
        id: p.string(model.id),
        plans: [],
        status: "unknown",
        conditions: {
          membership_scope: "guide states all LLMs via ChatLLM subscription",
          model_type: typeof model.model_type === "string" ? model.model_type : null,
          blocker:
            "verify Basic/Pro entitlement and reconcile purchased API-credit offering before publishing plan-specific grants",
        },
        evidence: [
          { url: p.string(urls[0]), locator: "data[].id" },
          { url: p.string(urls[1]), locator: "ChatLLM subscription / all-LLM guide" },
          { url: p.string(urls[2]), locator: "Purchased API credit FAQ" },
        ],
      }),
    );
}
function tencentCoding(bodies: Bodies): Row[] {
  const url = "https://cloud.tencent.com/document/product/1823/130092";
  const root = p.dom(p.required(bodies, url));
  const all = p.tables(root);
  const tiers = all.find((rows) => rows[0]?.[0] === "套餐内容");
  const supported = all.find((rows) => rows[0]?.join("|") === "模型|model 参数值|备注");
  assertCondition(tiers && supported, "Missing Tencent Coding Plan price/model table");
  assertCondition(
    p.text(root).includes("套餐支持的模型") && p.text(root).includes("暂不支持多模态能力"),
    "Tencent Coding Plan request scope changed",
  );
  const plans = (tiers[0] ?? []).slice(1);
  const ids = supported.slice(1).flatMap((cells) => p.string(cells[1]).split(/\s+/));
  return p.grants(
    ids,
    plans,
    url,
    "Package model table: model 参数值; applies to all Coding Plan tiers",
    {
      edition: "tencent-coding-plan",
      execution: "coding-agent",
      usage_scope: "interactive supported tools only",
      scripts_and_custom_backends: "forbidden",
      multimodal: "not supported",
      model_catalog: "dynamic; console and notices can supersede the public table",
    },
  );
}
function tencentToken(bodies: Bodies): Row[] {
  const url = "https://cloud.tencent.com/document/product/1823/130060";
  const root = p.dom(p.required(bodies, url));
  const prose = p.text(root);
  assertCondition(
    prose.includes("四个档位套餐均支持以下模型"),
    "Tencent Token Plan all-tier scope changed",
  );
  let edition: "general" | "hy" | null = null;
  let plans: string[] = [];
  const rows: Row[] = [];
  for (const node of p.list(root)) {
    if (/^h[1-6]$/.test(node.tagName ?? "")) {
      const title = p.text(node);
      if (title === "通用 Token Plan 套餐") {
        edition = "general";
        plans = [];
      }
      if (title === "Hy Token Plan 套餐") {
        edition = "hy";
        plans = [];
      }
    }
    if (node.tagName !== "table" || !edition) continue;
    const table = p.tables(node)[0];
    if (!table) continue;
    if (table[0]?.[0] === "套餐" && table[0]?.[1] === "用量限制") {
      plans = table.slice(1).map((cells) => {
        const tier = /[（(]([A-Za-z]+)[）)]/.exec(p.string(cells[0]))?.[1];
        assertCondition(tier, "Missing source-native Tencent Token Plan tier token");
        return `${edition}:${tier}`;
      });
    }
    if (table[0]?.[0] !== "Model Name" || table[0]?.[1] !== "Model ID") continue;
    assertCondition(
      plans.length > 0,
      "Missing series-specific Tencent plan tiers before model table",
    );
    for (const cells of table.slice(1)) {
      const ids = p.string(cells[1]).split(/\s+/);
      const notice = [cells[0], cells[2]].filter(Boolean).join(" ");
      const retiring = /下线/.test(notice);
      rows.push(
        ...p
          .grants(ids, plans, url, `${edition} Token Plan supported model table; Model ID column`, {
            edition: `tencent-token-${edition}`,
            execution: "coding-agent",
            source_display_name: p.string(cells[0]),
            source_retirement_notice: retiring ? notice : null,
            usage_scope: "interactive supported AI tools only",
            scripts_and_custom_backends: "forbidden",
            model_catalog:
              "dynamic; source explicitly defers actual access to purchase page, console and notices",
          })
          .map((row) => ({ ...row, status: retiring ? ("unknown" as const) : row.status })),
      );
    }
  }
  assertCondition(
    rows.length > 0 &&
      rows.some((row) => row.conditions?.edition === "tencent-token-general") &&
      rows.some((row) => row.conditions?.edition === "tencent-token-hy"),
    "Missing a Tencent Token Plan series",
  );
  return rows;
}
function kuae(bodies: Bodies): Row[] {
  const { urls, contents } = inputs("kuae-coding-plan", bodies);
  const [overview, config] = contents;
  assertCondition(overview && config, "Missing KUAE sources");
  const prose = p.text(p.dom(overview));
  const model = /订阅套餐后，在上述编程工具中调用\s*([A-Za-z][A-Za-z0-9.-]*)\s*时/.exec(prose)?.[1];
  assertCondition(model, "Missing normative KUAE subscribed-model identity sentence");
  const plans = [
    ...new Set([...prose.matchAll(/([A-Za-z]+ Plan)\s*套餐/g)].map((match) => p.string(match[1]))),
  ];
  assertCondition(
    p.text(p.dom(config)).includes(model),
    "KUAE configured model differs from subscription identity",
  );
  return p
    .grants(
      [model],
      plans,
      p.string(urls[0]),
      "Normative sentence: after subscription, this model uses package quota in supported tools",
      {
        execution: "coding-agent",
        usage_scope: "listed programming tools only",
        free_trial: "not inferred from paid subscription wording",
        other_models: "not inferred from configuration defaults or future update promises",
      },
    )
    .map((row) => ({
      ...row,
      evidence: [
        ...row.evidence,
        {
          url: p.string(urls[1]),
          locator: "Exact configured model matches normative subscription identity",
        },
      ],
    }));
}
export function extract(subscriptionId: string, bodies: Bodies): Row[] {
  switch (subscriptionId) {
    case "tencent-coding-plan":
      return tencentCoding(bodies);
    case "tencent-token-plan":
      return tencentToken(bodies);
    case "tencent-tokenhub-plans":
      return [...tencentToken(bodies), ...tencentCoding(bodies)];
    case "kuae-coding-plan":
      return kuae(bodies);
    case "nano-gpt-pro":
      return nano(bodies);
    case "huggingface-pro-inference-credits":
      return hf(bodies);
    case "venice-paid-plans":
      return venice(bodies);
    case "sparrowcodes":
      return sparrow(bodies);
    case "anonrouter":
      return anon(bodies);
    case "poe-subscription":
      return poe(bodies);
    case "abacus":
      return abacus(bodies);
    default:
      throw new Error(`No qualified public source for ${subscriptionId}`);
  }
}
