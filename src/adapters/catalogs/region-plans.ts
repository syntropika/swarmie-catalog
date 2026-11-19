import { parse } from "parse5";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Row = {
  id: string;
  plans: string[];
  status: "available" | "unavailable" | "unknown";
  conditions?: Record<string, Json>;
  api?: Record<string, string>;
  evidence: { url: string; locator: string }[];
};
type Node = {
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
  parentNode?: Node;
};
type Bodies = Record<string, string>;
const urls = {
  xpersonaModels: "https://www.xpersona.co/v1/models",
  xpersonaPlans: "https://www.xpersona.co/inference/pricing",
  trustedModels: "https://trustedtokens.eu/api/public/models",
  trustedPlans: "https://trustedtokens.eu/pricing/",
  regoloPlans: "https://regolo.ai/pricing/",
  regoloModels: "https://api.regolo.ai/models",
  jiekouPlans: "https://jiekou.vip/resource-pack",
  fireworksPlans: "https://docs.fireworks.ai/nexus/plans.md",
  fireworksAuto: "https://docs.fireworks.ai/nexus/auto.md",
  fireworksOpen: "https://docs.fireworks.ai/nexus/open-models.md",
  ollamaModels: "https://ollama.com/api/tags",
  ollamaPlans: "https://ollama.com/pricing",
  modelisPlans: "https://modelishub.com/pricing",
  alibabaPersonal:
    "https://docs.modelstudio.console.alibabacloud.com/en/model-studio/token-plan-personal-overview.md",
  alibabaTeam:
    "https://docs.modelstudio.console.alibabacloud.com/en/model-studio/token-plan-team-overview.md",
  alibabaCnPersonal: "https://help.aliyun.com/zh/model-studio/token-plan-personal-overview",
  alibabaCnTeam: "https://help.aliyun.com/zh/model-studio/token-plan-team-overview",
  alibabaLegacy: "https://www.alibabacloud.com/help/en/model-studio/coding-plan",
  alibabaCnLegacy: "https://help.aliyun.com/zh/model-studio/coding-plan",
};
function required(bodies: Bodies, url: string): string {
  const value = bodies[url];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing source: ${url}`);
  return value;
}
export function assertCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function list(node: Node): Node[] {
  return [node, ...(node.childNodes ?? []).flatMap(list)];
}
function text(node: Node): string {
  if (["script", "style", "nav", "header", "footer"].includes(node.tagName ?? "")) return "";
  return (node.value ?? (node.childNodes ?? []).map(text).join(" ")).replace(/\s+/g, " ").trim();
}
function attr(node: Node, name: string): string {
  return node.attrs?.find((entry) => entry.name === name)?.value ?? "";
}
function parseJsonValue(input: string): unknown {
  const first = input.search(/\S/);
  assertCondition(first >= 0 && input[first] === "{", "Expected a JSON object assignment");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = first; i < input.length; i += 1) {
    const c = input[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "{" || c === "[") depth += 1;
    else if (c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return JSON.parse(input.slice(first, i + 1));
    }
  }
  throw new Error("Unterminated JSON object assignment");
}
function object(value: unknown): Record<string, unknown> {
  assertCondition(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Expected an object",
  );
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  assertCondition(typeof value === "string" && value.length > 0, "Expected a non-empty string");
  return value;
}
function array(value: unknown): unknown[] {
  assertCondition(Array.isArray(value), "Expected an array");
  return value;
}
function article(source: string): string {
  const match = /window\.__ICE_PAGE_PROPS__\s*=/.exec(source);
  if (!match || match.index === undefined) return source;
  const data = object(parseJsonValue(source.slice(match.index + match[0].length)));
  return string(object(object(object(data.docDetailData).storeData).data).content);
}
function dom(source: string): Node {
  return parse(article(source)) as unknown as Node;
}
function tables(root: Node): string[][][] {
  return list(root)
    .filter((node) => node.tagName === "table")
    .map((table) =>
      list(table)
        .filter((node) => node.tagName === "tr")
        .map((row) =>
          (row.childNodes ?? [])
            .filter((node) => node.tagName === "th" || node.tagName === "td")
            .map(text),
        ),
    );
}
function grants(
  ids: string[],
  plans: string[],
  url: string,
  locator: string,
  conditions?: Record<string, Json>,
): Row[] {
  assertCondition(
    ids.length > 0 && new Set(ids).size === ids.length,
    "Expected non-empty unique model IDs",
  );
  assertCondition(
    plans.length > 0 && new Set(plans).size === plans.length,
    "Expected non-empty unique plans",
  );
  return ids.map((id) => ({
    id,
    plans,
    status: "available",
    ...(conditions ? { conditions } : {}),
    evidence: [{ url, locator }],
  }));
}
function xpersona(bodies: Bodies): Row[] {
  const root = dom(required(bodies, urls.xpersonaPlans));
  const planNames = list(root)
    .filter((n) => n.tagName === "h3" && attr(n, "id").startsWith("pricing-plan-"))
    .map(text);
  assertCondition(planNames.length > 0, "Missing Xpersona monthly plan headings");
  const prose = text(root);
  assertCondition(
    prose.includes("all four plans include the complete public catalog") &&
      prose.includes("Every monthly package unlocks the full catalog"),
    "Xpersona full-catalog membership changed",
  );
  const ids = array(object(JSON.parse(required(bodies, urls.xpersonaModels))).data).map((m) =>
    string(object(m).id),
  );
  return grants(ids, planNames, urls.xpersonaModels, "data[].id", {
    membership: "all published monthly plans",
    capacity: "supplier-weighted",
    overage: "requests pause at the allowance",
  }).map((row) => ({
    ...row,
    evidence: [
      ...row.evidence,
      { url: urls.xpersonaPlans, locator: "Monthly plans / full-catalog membership assertions" },
    ],
  }));
}
function trusted(bodies: Bodies): Row[] {
  const root = dom(required(bodies, urls.trustedPlans));
  const cards = list(root).filter(
    (n) =>
      n.tagName === "div" &&
      attr(n, "class")
        .split(/\s+/)
        .some((c) => c.startsWith("_pricing-card_")),
  );
  const plans = cards
    .filter((n) => text(n).includes("All chat models") && text(n).includes("usage credit / month"))
    .map((n) => {
      const name = list(n).find((c) => attr(c, "class").startsWith("_plan-name-text_"));
      assertCondition(name, "Missing TrustedTokens plan name");
      return text(name);
    });
  const models = array(object(JSON.parse(required(bodies, urls.trustedModels))).models)
    .map(object)
    .filter((m) => m.mode === "chat");
  const ids = models.map((m) => string(m.name));
  return grants(ids, plans, urls.trustedModels, "models[].name where mode == chat", {
    membership: "all chat models",
    excluded_contract_scope: "Tailored decision/embedding/custom capacity",
  }).map((row, index) => {
    const model = models[index];
    assertCondition(model, "Missing TrustedTokens model row");
    const lifecycle = array(model.providers).map((value) => {
      const provider = object(value);
      const state = object(provider.lifecycle);
      return {
        provider: string(provider.provider),
        state: string(state.state),
        ...(typeof state.removal_date === "string" ? { removal_date: state.removal_date } : {}),
      };
    });
    return {
      ...row,
      conditions: { ...row.conditions, provider_lifecycle: lifecycle },
      evidence: [
        ...row.evidence,
        { url: urls.trustedPlans, locator: "Plan cards: All chat models" },
      ],
    };
  });
}
function regolo(bodies: Bodies): Row[] {
  const root = dom(required(bodies, urls.regoloPlans));
  assertCondition(
    text(root).includes("Every chat model is included in every plan"),
    "Regolo all-plan explanation changed",
  );
  const grids = list(root).filter(
    (n) => n.tagName === "div" && /repeat\(4\s*,/.test(attr(n, "style")),
  );
  const values = grids.map((n) =>
    (n.childNodes ?? []).filter((c) => c.tagName === "div").map(text),
  );
  const headers = values.filter(
    (cells) => cells[0] === "Model" && cells[1]?.includes("Input cost") && cells[3]?.includes("·"),
  );
  assertCondition(headers.length === 1, "Missing or ambiguous Regolo subscription grid header");
  const plans = string(headers[0]?.[3])
    .split("·")
    .map((p) => p.trim());
  const ids = values
    .filter((cells) => cells.length === 4 && cells[3] === "Included")
    .map((cells) => string(cells[0]));
  const apiIds = new Set(
    array(object(JSON.parse(required(bodies, urls.regoloModels))).data).map((model) =>
      string(object(model).id),
    ),
  );
  assertCondition(
    ids.every((id) => apiIds.has(id)),
    "Regolo subscription grid has an ID absent from the current native catalog",
  );
  return grants(
    ids,
    plans,
    urls.regoloPlans,
    "Large Language Models CSS grid: Model / input / output / plan names; subscription Included",
    {
      exclusions: "Rows marked Not included do not consume included subscription allowance",
      allowance: "daily weighted tokens",
    },
  );
}
function jiekou(bodies: Bodies): Row[] {
  const root = dom(required(bodies, urls.jiekouPlans));
  const prose = text(root);
  assertCondition(
    prose.includes("可用于调用包内包含的任意模型") && prose.includes("融合 token"),
    "Jiekou package membership rule changed",
  );
  const names = list(root)
    .filter((n) => n.tagName === "span" && attr(n, "class").includes("font-h5"))
    .map(text)
    .map((name) => /^([A-Za-z0-9_-]+)\s*套餐$/.exec(name)?.[1])
    .filter((name): name is string => Boolean(name));
  const plans = [...new Set(names)];
  const matches = tables(root).filter(
    (rows) => rows[0]?.[0] === "模型" && rows[0].some((cell) => cell.includes("抵扣系数")),
  );
  assertCondition(matches.length === 1, "Missing Jiekou subscription deduction-factor table");
  const ids = (matches[0] ?? [])
    .slice(1)
    .filter((cells) => /^[A-Za-z][A-Za-z0-9._/-]*$/.test(cells[0] ?? ""))
    .map((cells) => string(cells[0]));
  return grants(
    ids,
    plans,
    urls.jiekouPlans,
    "Package-specific model and fused-token deduction-factor table; skip rowspan token-range continuations",
    {
      allowance: "fused tokens at model-specific factors",
      legacy_packages: "separate retained rights",
    },
  );
}
function fireworks(bodies: Bodies): Row[] {
  const plansBody = required(bodies, urls.fireworksPlans);
  const autoBody = required(bodies, urls.fireworksAuto);
  const openBody = required(bodies, urls.fireworksOpen);
  const model = /Use the model ID `([^`]+)`\./.exec(autoBody)?.[1];
  assertCondition(model, "Missing normative Nexus Auto model identity");
  assertCondition(
    openBody.includes(`Only \`${model}\` is accepted`) && /HTTP 403/.test(openBody),
    "Nexus direct-model subscription restriction changed",
  );
  const rows = tables(dom(plansBody))[0];
  assertCondition(rows, "Missing Fireworks plan table");
  const headers = rows[0] ?? [];
  const usage = rows.find((cells) => /Usage/.test(cells[0] ?? ""));
  const models = rows.find((cells) => /Models/.test(cells[0] ?? ""));
  assertCondition(usage && models, "Missing Fireworks usage/model table rows");
  const plans = headers.flatMap((name, i) =>
    i > 0 && /included usage/i.test(usage[i] ?? "") ? [name] : [],
  );
  return grants(
    [model],
    plans,
    urls.fireworksPlans,
    "Compare plans: included Usage + Models; pinned open models forbidden on Pro/Team",
    {
      router: "dynamic model selection",
      closed_model_billing: "customer provider account",
      pinned_enterprise_models: "usage-based",
    },
  ).map((row) => ({
    ...row,
    evidence: [
      ...row.evidence,
      { url: urls.fireworksAuto, locator: "Normative model ID" },
      { url: urls.fireworksOpen, locator: "Only auto accepted; named models HTTP 403 on Pro/Team" },
    ],
  }));
}
function tokenEdition(
  bodies: Bodies,
  url: string,
  edition: "personal" | "team",
  region: "singapore" | "china",
): Row[] {
  const source = required(bodies, url);
  const root = dom(source);
  const all = tables(root);
  let plans: string[];
  if (edition === "personal") {
    const benefits = all.find(
      (rows) =>
        rows[0]?.slice(1).every((cell) => /Lite|Essential|Standard|Pro/.test(cell)) &&
        rows.some((cells) => /Benefits|权益/.test(cells[0] ?? "")),
    );
    assertCondition(benefits, "Missing Token Plan Personal tier/benefits table");
    plans = (benefits[0] ?? []).slice(1);
    const values = benefits.find((cells) => /Benefits|权益/.test(cells[0] ?? ""))?.slice(1) ?? [];
    assertCondition(
      values.some((v) => /All Lite benefits|Lite\s*全部权益/.test(v)) &&
        values.some((v) => /All Standard benefits|Standard\s*全部权益/.test(v)),
      "Token Plan Personal inheritance rule changed",
    );
  } else {
    const seats = all.find((rows) => /Seat type|坐席类型/.test(rows[0]?.[0] ?? ""));
    assertCondition(seats, "Missing Token Plan Team seat table");
    plans = seats.slice(1).map((cells) => string(cells[0]));
  }
  const modelTables = all.filter((rows) => (rows[0]?.[0] ?? "").includes("Model ID"));
  assertCondition(modelTables.length > 0, "Missing Token Plan supported-model tables");
  const ids = modelTables.flatMap((rows) => rows.slice(1).map((cells) => string(cells[0])));
  const capabilities = new Map(
    modelTables.flatMap((rows) =>
      rows.slice(1).map((cells) => [string(cells[0]), string(cells[1])] as const),
    ),
  );
  const domainModelIds = new Set<string>();
  for (const element of list(root).filter((node) => node.tagName === "table")) {
    let ancestor: Node | undefined = element;
    let domain = false;
    while (ancestor) {
      const category = [attr(ancestor, "id"), attr(ancestor, "title")].join(" ");
      if (/领域模型|domain models|decision models/i.test(category)) domain = true;
      ancestor = ancestor.parentNode;
    }
    if (domain)
      for (const table of tables(element))
        if ((table[0]?.[0] ?? "").includes("Model ID"))
          for (const cells of table.slice(1)) domainModelIds.add(string(cells[0]));
  }
  return grants(
    ids,
    plans,
    url,
    "Supported models: first column Model ID; edition-specific plan/seat table",
    {
      edition,
      region,
      usage_scope: "interactive coding or agent tools only",
      scripts_and_custom_backends: "forbidden",
      plan_namespace: "preserve edition and region when normalizing plan IDs",
      multimodal_transport: "not every model supports chat APIs",
    },
  ).map((row) => ({
    ...row,
    conditions: {
      ...row.conditions,
      source_capabilities: capabilities.get(row.id) ?? null,
      source_domain_model_group: domainModelIds.has(row.id),
    },
  }));
}
function legacy(bodies: Bodies, url: string, region: "singapore" | "china"): Row[] {
  const root = dom(required(bodies, url));
  const matches = tables(root).filter((rows) =>
    rows.some((cells) => /^(Supported models|支持的模型)$/.test(cells[0] ?? "")),
  );
  assertCondition(matches.length === 1, "Missing legacy Coding Plan exact-version table");
  const cell = matches[0]?.find((cells) =>
    /^(Supported models|支持的模型)$/.test(cells[0] ?? ""),
  )?.[1];
  assertCondition(
    cell && /exact model versions|精确版本/.test(cell),
    "Legacy Coding Plan exact-version rule changed",
  );
  const ids = [...new Set(cell.match(/\b[A-Za-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)+\b/g) ?? [])];
  const planHeader = matches[0]?.[0]?.[1];
  assertCondition(planHeader?.startsWith("Pro"), "Legacy Coding Plan tier changed");
  const result = grants(ids, ["Pro"], url, "Pro Supported models exact-version row", {
    edition: "legacy-coding-plan",
    region,
    usage_scope: "interactive coding tools only",
    scripts_and_custom_backends: "forbidden",
  });
  const prose = text(root);
  assertCondition(
    /Lite.*same as the Pro plan|Lite.*与 Pro 套餐一致/.test(prose),
    "Missing explicit grandfathered Lite model equivalence",
  );
  return [
    ...result,
    ...grants(ids, ["Lite"], url, "Grandfathered Lite explicitly has same models as Pro", {
      edition: "legacy-coding-plan",
      region,
      purchase_state: "grandfathered",
      renewals: "closed",
      upgrades: "closed",
      usage_scope: "interactive coding tools only",
    }),
  ];
}
function ollama(bodies: Bodies): Row[] {
  required(bodies, urls.ollamaPlans);
  const models = array(object(JSON.parse(required(bodies, urls.ollamaModels))).models);
  return models.map((m) => ({
    id: string(object(m).name),
    plans: [],
    status: "unknown",
    conditions: {
      discovery: "public cloud model catalog",
      limitation: "Pro larger-model and Max early-access gates are not encoded in public tags",
    },
    evidence: [
      { url: urls.ollamaModels, locator: "models[].name" },
      { url: urls.ollamaPlans, locator: "Paid credits / larger Pro models / Max early access" },
    ],
  }));
}
function modelis(bodies: Bodies): Row[] {
  const all = tables(dom(required(bodies, urls.modelisPlans)));
  const matches = all.filter((rows) => rows[0]?.[0] === "Provider" && rows[0]?.[1] === "Models");
  assertCondition(matches.length === 1, "Missing Modelis flagship catalog");
  return (matches[0] ?? []).slice(1).flatMap((cells) =>
    string(cells[1])
      .split(/\s+/)
      .map(
        (id): Row => ({
          id,
          plans: [],
          status: "unknown",
          conditions: {
            discovery: "partial flagship catalog",
            limitation:
              "specialist/regional models may vary by plan; complete subscription membership is not public",
          },
          evidence: [
            {
              url: urls.modelisPlans,
              locator: "Provider / Models table and explicit plan variation caveat",
            },
          ],
        }),
      ),
  );
}
export function extract(subscriptionId: string, bodies: Bodies): Row[] {
  switch (subscriptionId) {
    case "xpersona-subscription":
      return xpersona(bodies);
    case "trustedtokens-subscription":
      return trusted(bodies);
    case "regolo-subscription":
      return regolo(bodies);
    case "jiekou":
      return jiekou(bodies);
    case "fireworks-ai":
      return fireworks(bodies);
    case "ollama-cloud-subscription":
      return ollama(bodies);
    case "modelis":
      return modelis(bodies);
    case "alibaba":
      return [
        ...tokenEdition(bodies, urls.alibabaPersonal, "personal", "singapore"),
        ...tokenEdition(bodies, urls.alibabaTeam, "team", "singapore"),
        ...legacy(bodies, urls.alibabaLegacy, "singapore"),
      ];
    case "alibaba-cn-coding-plan":
    case "alibaba-coding-plan-cn":
      return legacy(bodies, urls.alibabaCnLegacy, "china");
    case "alibaba-coding-plan-intl":
      return legacy(bodies, urls.alibabaLegacy, "singapore");
    case "alibaba-token-plan-intl":
      return [
        ...tokenEdition(bodies, urls.alibabaPersonal, "personal", "singapore"),
        ...tokenEdition(bodies, urls.alibabaTeam, "team", "singapore"),
      ];
    case "alibaba-token-plan-cn":
      return [
        ...tokenEdition(bodies, urls.alibabaCnPersonal, "personal", "china"),
        ...tokenEdition(bodies, urls.alibabaCnTeam, "team", "china"),
      ];
    default:
      throw new Error(`No qualified public source for ${subscriptionId}`);
  }
}

export const sourceParsers = {
  dom,
  list,
  text,
  attr,
  tables,
  required,
  object,
  string,
  array,
  grants,
  assert: assertCondition,
};

export const coreSourceManifest: Record<string, string[]> = {
  "xpersona-subscription": [urls.xpersonaModels, urls.xpersonaPlans],
  "trustedtokens-subscription": [urls.trustedModels, urls.trustedPlans],
  "regolo-subscription": [urls.regoloPlans, urls.regoloModels],
  jiekou: [urls.jiekouPlans],
  "fireworks-ai": [urls.fireworksPlans, urls.fireworksAuto, urls.fireworksOpen],
  "ollama-cloud-subscription": [urls.ollamaModels, urls.ollamaPlans],
  modelis: [urls.modelisPlans],
  alibaba: [urls.alibabaPersonal, urls.alibabaTeam, urls.alibabaLegacy],
  "alibaba-cn-coding-plan": [urls.alibabaCnLegacy],
  "alibaba-coding-plan-cn": [urls.alibabaCnLegacy],
  "alibaba-coding-plan-intl": [urls.alibabaLegacy],
  "alibaba-token-plan-intl": [urls.alibabaPersonal, urls.alibabaTeam],
  "alibaba-token-plan-cn": [urls.alibabaCnPersonal, urls.alibabaCnTeam],
};
