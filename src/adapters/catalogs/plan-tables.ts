import { type DefaultTreeAdapterMap, parse } from "parse5";
import { requiredValue } from "./validation.ts";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
export type JSON =
  | null
  | boolean
  | number
  | string
  | JSON[]
  | {
      [key: string]: JSON;
    };
export interface ExtractedRow {
  id: string;
  plans: string[];
  status: "available" | "unavailable" | "unknown";
  conditions?: Record<string, JSON>;
  api?: Record<string, string>;
  evidence: {
    url: string;
    locator: string;
  }[];
}
const URLS = {
  aigrow: "https://aigrow.gg/ai-api",
  huaweiPlans: "https://support.huaweicloud.com/Token-Plan-maas/tokenplan-maas-0001.html",
  huaweiIds: "https://support.huaweicloud.com/Token-Plan-maas/tokenplan-maas-0008.html",
  nan: "https://nan.builders/docs/choose-a-model",
  nanPlans: "https://nan.builders/",
  scnet: "https://www.scnet.cn/ac/openapi/doc/2.0/moduleapi/plans/token-plan.html",
  uplink: "https://api.uplinkswitch.com/v1/catalog",
  uplinkPlans: "https://uplinkswitch.ai/",
  xiaomi: "https://mimo.mi.com/docs/en-US/tokenplan/Token%20Plan/subscription",
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
function aigrow(bodies: Record<string, string>): ExtractedRow[] {
  const url = URLS.aigrow;
  const doc = parse(body(bodies, url));
  const monthly = exactlyOne(
    elements(doc, (element) => attr(element, "id") === "monthly-plans"),
    "AIGROW monthly plan section",
  );
  const plans = unique(
    elements(monthly, (element) => element.tagName === "button").map((button) => {
      const match = /^Subscribe for (\$[\d,]+) a month$/.exec(text(button));
      requireCondition(match, "AIGROW monthly subscription action changed");
      return `${match[1]}/month`;
    }),
    "AIGROW plan labels",
  );
  const page = text(doc);
  requireCondition(
    page.includes("Monthly plans") &&
      page.includes("Requests are billed per token from your credit"),
    "AIGROW shared-credit scope changed",
  );
  const table = tableWithHeader(doc, [
    "Model",
    "Maker’s list price",
    "With AIGROW credit",
    "Below list",
    "Certified genuine by AIGROW",
  ]);
  return rows(table)
    .slice(1)
    .map((cells) => {
      requireCondition(cells.length === 5, "AIGROW rate row shape changed");
      const id = text(
        exactlyOne(
          elements(requiredValue(cells[0]), (element) => element.tagName === "code"),
          "AIGROW native model code",
        ),
      );
      requireCondition(
        /^[A-Za-z0-9][A-Za-z0-9._/-]+$/.test(id),
        "AIGROW native ID is not a single identifier",
      );
      return {
        id,
        plans,
        status: "available",
        conditions: {
          billing: "monthly-api-credit",
          source_model_label: text(requiredValue(cells[0])),
          previous_version: text(requiredValue(cells[0])).includes("Previous version"),
          credit_price: text(requiredValue(cells[2])),
        },
        evidence: evidence(
          url,
          `table[Model/Maker’s list price/With AIGROW credit] code=${id}; #monthly-plans`,
        ),
      };
    });
}
function huawei(bodies: Record<string, string>): ExtractedRow[] {
  const plansDoc = parse(body(bodies, URLS.huaweiPlans));
  const planTable = tableWithHeader(plansDoc, ["模型名称", "套餐", "适用场景", "用量限制", "价格"]);
  const planRows = rows(planTable).slice(1);
  const firstRow = planRows[0];
  requireCondition(firstRow?.length === 5, "Huawei first package row shape changed");
  requireCondition(
    attr(requiredValue(firstRow[0]), "rowspan") === String(planRows.length),
    "Huawei models no longer span all package rows",
  );
  requireCondition(
    planRows.slice(1).every((row) => row.length === 4),
    "Huawei package scope no longer has a shared model cell",
  );
  const plans = unique(
    planRows.map((row, index) => text(requiredValue(row[index === 0 ? 1 : 0]))),
    "Huawei package names",
  );
  const doc = parse(body(bodies, URLS.huaweiIds));
  const parameterTable = tableWithHeader(doc, ["参数", "说明", "示例"]);
  const parameterRows = rows(parameterTable).slice(1);
  const modelRow = exactlyOne(
    parameterRows.filter((row) => text(requiredValue(row[0])) === "models"),
    "Huawei models parameter row",
  );
  requireCondition(modelRow.length === 3, "Huawei models parameter shape changed");
  const nativeIds = unique(
    elements(requiredValue(modelRow[1]), (element) => element.tagName === "li").map(text),
    "Huawei native IDs",
  );
  const displayNames = elements(
    requiredValue(firstRow[0]),
    (element) => element.tagName === "p",
  ).map(text);
  const nameRow = exactlyOne(
    parameterRows.filter((row) => text(requiredValue(row[0])) === "name"),
    "Huawei display-name parameter row",
  );
  const integrationNames = elements(
    requiredValue(nameRow[1]),
    (element) => element.tagName === "li",
  ).map(text);
  requireCondition(
    displayNames.length === nativeIds.length &&
      [...displayNames].sort().join("\u0000") === [...integrationNames].sort().join("\u0000"),
    "Huawei overview and integration model scopes differ",
  );
  const baseRow = exactlyOne(
    parameterRows.filter((row) => text(requiredValue(row[0])) === "baseURL"),
    "Huawei baseURL row",
  );
  const api = text(requiredValue(baseRow[2]));
  requireCondition(
    /^https:\/\/[^\s]+\/plan\/v2$/.test(api),
    "Huawei subscription endpoint shape changed",
  );
  requireCondition(
    text(plansDoc).includes("套餐额度仅在AI工具中生效，不可用于API调用"),
    "Huawei tool-only restriction changed",
  );
  return nativeIds.map((id) => ({
    id,
    plans,
    status: "available",
    api: { "openai-chat-completions": api },
    conditions: {
      scope: "supported-ai-tools-only",
      region: "southwest-guiyang-1",
      general_api_usage: "excluded",
      native_id_case: "preserved",
    },
    evidence: [
      ...evidence(
        URLS.huaweiPlans,
        "Token Plan个人版套餐详情 table; shared model cell rowspan covers all plans",
      ),
      ...evidence(URLS.huaweiIds, `parameter table models list item=${id}`),
    ],
  }));
}
function nan(bodies: Record<string, string>): ExtractedRow[] {
  const url = URLS.nan;
  const doc = parse(body(bodies, url));
  const pool = exactlyOne(
    elements(
      doc,
      (element) =>
        element.tagName === "p" && text(element).startsWith("One pool of credits for every model"),
    ),
    "NaN shared-credit paragraph",
  );
  const match = /model (.+?) and (.+?) include credits every billing period:/.exec(text(pool));
  requireCondition(
    match && text(pool).includes("Every model marked credits draws from that same pool"),
    "NaN named plan credit scope changed",
  );
  const plans = unique([requiredValue(match[1]), requiredValue(match[2])], "NaN plan names");
  const home = text(parse(body(bodies, URLS.nanPlans)));
  requireCondition(
    home.includes("The models we host ourselves draw no credits") &&
      home.includes("for every chat model, the larger ones included"),
    "NaN plan scope for self-hosted or larger models changed",
  );
  const table = tableWithHeader(doc, ["id", "What for", "Context", "Accepts", "Billing"]);
  return rows(table)
    .slice(1)
    .map((row) => {
      requireCondition(row.length === 5, "NaN model row shape changed");
      const id = text(
        exactlyOne(
          elements(requiredValue(row[0]), (element) => element.tagName === "code"),
          "NaN native ID",
        ),
      );
      const billing = text(requiredValue(row[4]));
      requireCondition(
        billing.startsWith("credits") ||
          billing === "no counter" ||
          /^\d+ requests\/month(?: \(shared pool\))?$/.test(billing),
        "NaN billing class changed",
      );
      return {
        id,
        plans,
        status: "available",
        conditions: {
          source_context: text(requiredValue(row[2])),
          source_task: text(requiredValue(row[1])),
          billing_class: billing,
          community_included_credits: false,
          account_availability: "user-key-model-list-is-authoritative",
          general_rate_limits_apply: true,
        },
        evidence: [
          ...evidence(url, `Every model table id=${id}; One pool of credits for every model`),
          ...evidence(
            URLS.nanPlans,
            "Inference membership includes shared cluster and every chat model",
          ),
        ],
      };
    });
}
function scnet(bodies: Record<string, string>): ExtractedRow[] {
  const url = URLS.scnet;
  const doc = parse(body(bodies, url));
  const all = text(doc);
  requireCondition(
    /各档位套餐均支持\s*可用模型\s*列表中的全部模型/.test(all),
    "SCNet all-tier membership rule changed",
  );
  requireCondition(
    all.includes("严禁 API 调用") &&
      all.includes("自动化脚本") &&
      all.includes("自定义应用程序后端"),
    "SCNet tool-only scope changed",
  );
  const planTable = tableWithHeader(doc, [
    "套餐",
    "原价（¥/月）",
    "活动价（¥/月）",
    "月度额度",
    "适用场景",
  ]);
  const plans = unique(
    rows(planTable)
      .slice(1)
      .map((row) => text(requiredValue(row[0]))),
    "SCNet tier names",
  );
  const modelTable = tableWithHeader(doc, ["品牌", "模型ID", "模型能力", "支持协议"]);
  return rows(modelTable)
    .slice(1)
    .map((row) => {
      requireCondition(row.length === 4, "SCNet model row shape changed");
      const id = text(requiredValue(row[1]));
      return {
        id,
        plans,
        status: "available",
        conditions: {
          scope: "supported-interactive-ai-tools-only",
          general_api_usage: "excluded",
          native_protocols: text(requiredValue(row[3])),
          capabilities: text(requiredValue(row[2])),
          quota_exhaustion: "request-fails-without-payg-fallback",
        },
        evidence: evidence(
          url,
          `Available models table 模型ID=${id}; preceding all-tier membership sentence`,
        ),
      };
    });
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
function uplink(bodies: Record<string, string>): ExtractedRow[] {
  const catalog = object(JSON.parse(body(bodies, URLS.uplink)), "UplinkSwitch catalog");
  requireCondition(catalog.object === "list", "UplinkSwitch catalog object changed");
  const home = parse(body(bodies, URLS.uplinkPlans));
  const plans = array(catalog.plans, "UplinkSwitch plans").map((rawPlan) => {
    const plan = object(rawPlan, "UplinkSwitch plan");
    const id = string(plan.id, "plan ID");
    const name = string(plan.name, "plan name");
    const heading = exactlyOne(
      elements(home, (element) => element.tagName === "h3" && text(element) === name),
      `UplinkSwitch monthly ${name} card heading`,
    );
    let card: Node | null = heading.parentNode;
    while (
      card &&
      !("tagName" in card && (attr(card, "class") ?? "").split(/\s+/).includes("bg-card"))
    )
      card = "parentNode" in card ? card.parentNode : null;
    requireCondition(
      card &&
        text(card).includes("Every model on one key") &&
        text(card).includes("Renews by card"),
      `UplinkSwitch ${name} all-model grant changed`,
    );
    requireCondition(
      elements(card, (element) => element.tagName === "h3").length === 1,
      "UplinkSwitch monthly card boundary changed",
    );
    requireCondition(
      typeof plan.month_usd === "number" && typeof plan.usage_usd === "number",
      "UplinkSwitch monthly credit shape changed",
    );
    return id;
  });
  unique(plans, "UplinkSwitch plan IDs");
  return array(catalog.data, "UplinkSwitch models").map((rawModel) => {
    const entry = object(rawModel, "UplinkSwitch model");
    const id = string(entry.id, "UplinkSwitch native ID");
    const availability = string(entry.availability, "UplinkSwitch availability");
    requireCondition(
      ["ok", "down", "degraded", "unknown"].includes(availability),
      "UplinkSwitch availability enum changed",
    );
    const status =
      availability === "ok" ? "available" : availability === "down" ? "unavailable" : "unknown";
    return {
      id,
      plans,
      status,
      conditions: {
        native_endpoints: array(entry.endpoints, "UplinkSwitch native endpoints").map((endpoint) =>
          string(endpoint, "native endpoint"),
        ),
        operational_availability: availability,
        model_type: string(entry.type, "UplinkSwitch model type"),
        wire_formats: array(entry.wire_formats, "UplinkSwitch wire formats").map((format) =>
          string(format, "wire format"),
        ),
        balance_lifetime: "one-month",
      },
      evidence: [
        ...evidence(URLS.uplink, `$.data[id=${id}]; $.plans[*].id`),
        ...evidence(URLS.uplinkPlans, "Each matching monthly card contains Every model on one key"),
      ],
    };
  });
}
function xiaomi(bodies: Record<string, string>): ExtractedRow[] {
  const url = URLS.xiaomi;
  const doc = parse(body(bodies, url));
  const scope = exactlyOne(
    elements(
      doc,
      (element) => element.tagName === "p" && text(element).startsWith("Covers flagship models"),
    ),
    "Xiaomi flagship membership paragraph",
  );
  const scopeText = text(scope);
  requireCondition(scopeText.includes("all plans support"), "Xiaomi all-plan model grant changed");
  const ids = unique(scopeText.match(/\bmimo-[a-z0-9][a-z0-9.-]*\b/g) ?? [], "Xiaomi native IDs");
  const declaredCount = /a total of (\d+) models/.exec(scopeText);
  requireCondition(
    declaredCount && Number(declaredCount[1]) === ids.length,
    "Xiaomi declared model count differs",
  );
  const monthlyTable = exactlyOne(
    elements(doc, (element) => element.tagName === "table").filter((table) => {
      const data = rows(table);
      return (
        data[0]?.[0] &&
        text(data[0][0]) === "" &&
        data[1]?.[0] &&
        text(data[1][0]) === "Pricing" &&
        text(requiredValue(data[1][1])).includes("/month")
      );
    }),
    "Xiaomi monthly package table",
  );
  const plans = unique(
    requiredValue(rows(monthlyTable)[0]).slice(1).map(text),
    "Xiaomi monthly tier names",
  );
  const all = text(doc);
  requireCondition(
    all.includes("automated scripts") && all.includes("custom") && all.includes("prohibited"),
    "Xiaomi non-coding usage exclusion changed",
  );
  const chatCostTable = tableWithHeader(doc, [
    "model",
    "Input (Cache Hit) Token",
    "Input (cache miss) Token",
    "Output Token",
  ]);
  const chatIds = unique(
    rows(chatCostTable)
      .slice(1)
      .map((row) => text(requiredValue(row[0]))),
    "Xiaomi chat conversion IDs",
  );
  requireCondition(
    chatIds.every((id) => ids.includes(id)),
    "Xiaomi conversion IDs missing from all-plan membership paragraph",
  );
  const sharedConditions = {
    scope: "supported-programming-tools-only",
    general_api_usage: "excluded",
    package_kind: "individual",
  };
  const output: ExtractedRow[] = ids.map((id) => ({
    id,
    plans,
    status: "available",
    conditions: {
      ...sharedConditions,
      model_kind: chatIds.includes(id) ? "text-chat" : "non-chat",
    },
    evidence: evidence(
      url,
      `Core Strengths > Covers flagship models: ${id}; Monthly Plan table header`,
    ),
  }));
  const retirement = elements(
    doc,
    (element) => element.tagName === "p" && text(element).includes("were officially taken offline"),
  );
  for (const paragraph of retirement) {
    const retiredIds = unique(
      text(paragraph).match(/\bmimo-[a-z0-9][a-z0-9.-]*\b/g) ?? [],
      "Xiaomi retired model IDs",
    );
    for (const id of retiredIds)
      output.push({
        id,
        plans,
        status: "unavailable",
        conditions: { ...sharedConditions, retired: true, retirement_notice: text(paragraph) },
        evidence: evidence(url, `Explicit retirement notice: ${id}`),
      });
  }
  return output;
}
export function extract(subscriptionId: string, bodies: Record<string, string>): ExtractedRow[] {
  let result: ExtractedRow[];
  switch (subscriptionId) {
    case "aigrow-subscription":
      result = aigrow(bodies);
      break;
    case "huawei-maas":
      result = huawei(bodies);
      break;
    case "nan":
      result = nan(bodies);
      break;
    case "scnet-token-plan":
      result = scnet(bodies);
      break;
    case "uplinkswitch-subscription":
      result = uplink(bodies);
      break;
    case "xiaomi-token-plan":
    case "xiaomi-mimo-token-plan":
      result = xiaomi(bodies);
      break;
    default:
      throw new Error(`Unsupported subscription source: ${subscriptionId}`);
  }
  unique(
    result.map((row) => row.id),
    "native model IDs",
  );
  return result.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}
