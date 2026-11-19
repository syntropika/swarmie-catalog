import { parse } from "parse5";
import { requiredValue } from "./validation.ts";

type Json =
  | null
  | string
  | number
  | boolean
  | Json[]
  | {
      [key: string]: Json;
    };
type Obj = Record<string, unknown>;
type Html = {
  tagName?: string;
  nodeName: string;
  value?: string;
  attrs?: {
    name: string;
    value: string;
  }[];
  childNodes?: Html[];
};
export type Extracted = {
  id: string;
  plans: string[];
  status: "available" | "unavailable" | "unknown";
  conditions?: Record<string, Json>;
  api?: Record<string, string>;
  evidence: {
    url: string;
    locator: string;
  }[];
};
function obj(value: unknown): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected object");
  return value as Obj;
}
function arr(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected array");
  return value;
}
function str(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Expected nonempty string");
  return value;
}
function body(bodies: Record<string, string>, url: string): string {
  const result = bodies[url];
  if (!result) throw new Error(`Missing body ${url}`);
  return result;
}
function json(bodies: Record<string, string>, url: string): unknown {
  return JSON.parse(body(bodies, url));
}
function root(value: string): Html {
  return parse(value) as unknown as Html;
}
function all(node: Html, predicate: (node: Html) => boolean): Html[] {
  return [
    ...(predicate(node) ? [node] : []),
    ...(node.childNodes ?? []).flatMap((child) => all(child, predicate)),
  ];
}
function tags(node: Html, tag: string): Html[] {
  return all(node, (node) => node.tagName === tag);
}
function attr(node: Html, key: string): string | undefined {
  return node.attrs?.find((a) => a.name === key)?.value;
}
function clean(value: string): string {
  return value
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function rawText(node: Html): string {
  if (node.tagName === "script" || node.tagName === "style") return "";
  return (node.value ?? "") + (node.childNodes ?? []).map(rawText).join("");
}
function text(node: Html): string {
  if (node.tagName === "script" || node.tagName === "style") return "";
  return clean((node.value ?? "") + (node.childNodes ?? []).map(text).join(" "));
}
function must(value: string, needle: string): void {
  if (!value.includes(needle)) throw new Error(`Changed scope: ${needle}`);
}
function unique(values: string[]): string[] {
  return [...new Set(values)];
}
function tableRows(table: Html): string[][] {
  return tags(table, "tr").map((row) =>
    all(row, (node) => node.tagName === "td" || node.tagName === "th").map(text),
  );
}
function tableByHeaders(document: Html, headers: string[]): string[][] {
  const matches = tags(document, "table")
    .map(tableRows)
    .filter((rows) => rows.length > 1 && JSON.stringify(rows[0]) === JSON.stringify(headers));
  if (matches.length !== 1) throw new Error(`Missing/ambiguous table ${headers.join(",")}`);
  return requiredValue(matches[0]).slice(1);
}
function plain(value: string): string {
  return value.replace(/\*|`/g, "").trim();
}
function markdownTable(md: string, heading: string): string[][] {
  const lines = md.split(/\r?\n/);
  let start = lines.findIndex((line) => line.replace(/^#{1,6} /, "") === heading);
  if (start < 0) throw new Error(`Missing heading ${heading}`);
  const section = lines.slice(start + 1);
  const end = section.findIndex((line) => /^#{1,6} /.test(line));
  const part = end < 0 ? section : section.slice(0, end);
  start = part.findIndex((line) => line.startsWith("|"));
  if (start < 0) throw new Error("Missing table");
  const rows: string[][] = [];
  for (const line of part.slice(start)) {
    if (!line.startsWith("|")) break;
    rows.push(
      line
        .split("|")
        .slice(1, -1)
        .map((s) => s.trim()),
    );
  }
  if (rows.length < 3) throw new Error("Empty table");
  return [requiredValue(rows[0]), ...rows.slice(2)];
}
function ioNet(bodies: Record<string, string>): Extracted[] {
  const u = "https://api.intelligence.io.solutions/api/v1/models",
    scope = "https://io.net/docs/guides/payment/io-intelligence-payments.md";
  const catalog = obj(json(bodies, u));
  if (catalog.object !== "list") throw new Error("Changed models envelope");
  const md = body(bodies, scope);
  must(md, "Each plan provides access to the same advanced models and tools.");
  must(md, "Credits can be spent on any model");
  must(clean(md), "**Chat** interactions count toward your API quota");
  const table = markdownTable(md, "Plan Overview");
  if (JSON.stringify(table[0]) !== JSON.stringify(["Plan", "Usage", "Refresh cycle", "Ideal for"]))
    throw new Error("Changed plan columns");
  const plans = table
    .slice(1)
    .filter((c) => requiredValue(c[1]).includes("monthly usage credits"))
    .map((c) => plain(requiredValue(c[0])));
  if (!plans.length) throw new Error("No monthly credit plans");
  return arr(catalog.data)
    .map(obj)
    .map((m) => {
      const id = str(m.id);
      const gated = m.higher_tier_required !== false;
      return {
        id,
        plans,
        status: gated ? "unknown" : "available",
        conditions: {
          route_ids: ["api"],
          min_access_tier: typeof m.min_access_tier === "number" ? m.min_access_tier : null,
          higher_tier_required:
            typeof m.higher_tier_required === "boolean" ? m.higher_tier_required : null,
          tier_to_plan_mapping_unresolved: gated,
          input_token_price: typeof m.input_token_price === "number" ? m.input_token_price : null,
          output_token_price:
            typeof m.output_token_price === "number" ? m.output_token_price : null,
        },
        api: { "openai-chat-completions": "https://api.intelligence.io.solutions/api/v1" },
        evidence: [
          { url: u, locator: `$.data[id=${id}]` },
          { url: scope, locator: "Plan Overview; shared all-model credits; Chat/API shared quota" },
        ],
      };
    });
}
function augure(bodies: Record<string, string>): Extracted[] {
  const u = "https://augureai.ca/docs/api",
    scope = "https://augureai.ca/pricing";
  const docs = root(body(bodies, u)),
    pricing = text(root(body(bodies, scope)));
  const plan = pricing.match(
    /On ([A-Za-z]+), API keys draw on the plan's allowance instead\./,
  )?.[1];
  if (!plan) throw new Error("Missing exact funded plan");
  must(
    text(docs),
    "keys draw that plan’s shared allowance instead of being metered, and stop when it runs out.",
  );
  const rows = tableByHeaders(docs, ["Model", "Context", "Max output", "Best for"]);
  return rows.map((c) => {
    const id = str(c[0]);
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) throw new Error("Malformed native ID");
    return {
      id,
      plans: [plan],
      status: "available",
      conditions: {
        route_ids: ["direct-model-subscription"],
        context: requiredValue(c[1]),
        max_output: requiredValue(c[2]),
        scope: requiredValue(c[3]),
        no_separately_billed_fallback: true,
      },
      api: { "openai-chat-completions": "https://api.augureai.ca/v1" },
      evidence: [
        { url: u, locator: `Models table; Model=${id}; Teams and labs shared Ultra allowance` },
        { url: scope, locator: "Developer API included subscription FAQ" },
      ],
    };
  });
}
function synthetic(bodies: Record<string, string>): Extracted[] {
  const u = "https://api.synthetic.new/openai/v1/models",
    docsUrl = "https://dev.synthetic.new/docs/api/models",
    priceUrl = "https://synthetic.new/pricing";
  const catalog = obj(json(bodies, u));
  if (JSON.stringify(Object.keys(catalog)) !== JSON.stringify(["data"]))
    throw new Error("Changed models envelope");
  const docs = root(body(bodies, docsUrl)),
    pricing = root(body(bodies, priceUrl));
  const scope = text(docs);
  must(scope, "Always-On and Embeddings models are included in every subscription");
  const buttons = tags(pricing, "button").filter(
    (button) =>
      text(button).includes("/month") &&
      tags(button, "span").some((s) => (attr(s, "class") ?? "").includes("font-semibold")),
  );
  const plans = buttons.map((button) =>
    text(
      requiredValue(
        tags(button, "span").find((s) => (attr(s, "class") ?? "").includes("font-semibold")),
      ),
    ),
  );
  if (!plans.length) throw new Error("Missing recurring plans");
  const included = text(pricing).match(
    /Fast mode and Infinite mode are included with the (.+?) plan/,
  )?.[1];
  if (!included) throw new Error("Missing infinite plan scope");
  const infinitePlans = included.split(/ or /);
  if (infinitePlans.some((p) => !plans.includes(p))) throw new Error("Unknown infinite plan");
  const order = all(docs, (n) => n.tagName === "h2" || n.tagName === "h3" || n.tagName === "table");
  function tableUnder(label: string): Html {
    const i = order.findIndex((n) => n.tagName !== "table" && text(n) === label);
    if (i < 0) throw new Error(`Missing heading ${label}`);
    const t = order.slice(i + 1).find((n) => n.tagName === "table");
    if (!t) throw new Error(`Missing ${label} table`);
    return t;
  }
  const infiniteTable = tableRows(tableUnder("Infinite Aliases"));
  if (JSON.stringify(infiniteTable[0]) !== JSON.stringify(["Alias", "Resolves To", "Category"]))
    throw new Error("Changed alias table");
  const infiniteIds = infiniteTable.slice(1).map((c) => requiredValue(c[0]));
  const output: Extracted[] = arr(catalog.data)
    .map(obj)
    .map((m) => {
      const id = str(m.id);
      if (typeof m.always_on !== "boolean") throw new Error("Missing always_on");
      const infinite = infiniteIds.includes(id);
      return {
        id,
        plans: infinite ? infinitePlans : plans,
        status: m.always_on ? "available" : "unknown",
        conditions: {
          route_ids: ["synthetic-api"],
          always_on: m.always_on,
          alias_of: typeof m.alias_of === "string" ? m.alias_of : null,
          infinite_mode: infinite,
        },
        evidence: [
          { url: u, locator: `$.data[id=${id}]` },
          { url: docsUrl, locator: "Subscriptions; Infinite Aliases" },
          { url: priceUrl, locator: "Monthly plan cards; Infinite mode included plan sentence" },
        ],
      };
    });
  const embedding = tableUnder("Embedding Models");
  const rows = tags(embedding, "tr");
  if (
    JSON.stringify(tableRows(embedding)[0]) !==
    JSON.stringify(["Model", "Provider", "Context length", "Status"])
  )
    throw new Error("Changed embedding table");
  for (const row of rows.slice(1)) {
    const cells = all(row, (n) => n.tagName === "td" || n.tagName === "th");
    if (text(requiredValue(cells[3])) !== "✓ Included") continue;
    const code =
      tags(requiredValue(cells[0]), "code")[0] ??
      tags(requiredValue(cells[0]), "a").find((a) =>
        (attr(a, "href") ?? "").startsWith("https://huggingface.co/"),
      );
    if (!code) throw new Error("Missing exact embedding ID");
    const id = clean(rawText(code));
    if (!id.startsWith("hf:")) throw new Error("Changed native embedding identifier");
    output.push({
      id,
      plans,
      status: "available",
      conditions: {
        route_ids: [],
        endpoint_family: "embeddings",
        transport_contract_unqualified: true,
      },
      evidence: [
        { url: docsUrl, locator: `Embedding Models table; Model=${id}; Status=Included` },
        { url: priceUrl, locator: "Monthly plan cards" },
      ],
    });
  }
  return output;
}
function volcengine(bodies: Record<string, string>): Extracted[] {
  const u = "https://docs.volcengine.com/docs/ark/agent-plan-personal-plan-overview?lang=zh",
    doc = root(body(bodies, u));
  const rows = tableByHeaders(doc, [
    "分类",
    "领域",
    "模型名称",
    "长度限制(token)",
    "Small",
    "Medium",
    "Large",
    "Max",
  ]);
  const plans = ["Small", "Medium", "Large", "Max"];
  must(text(doc), "文本生成模型及向量化模型不可用于 API 调用");
  let category = "";
  const output: Extracted[] = [];
  for (const [i, c] of rows.entries()) {
    if (c.length !== 8) throw new Error("Changed matrix width");
    if (c[0]) category = c[0];
    if (category !== "模型") continue;
    const id = requiredValue(c[2]).match(/^([a-z0-9][a-z0-9.-]*)\b/)?.[1];
    if (!id) throw new Error("Missing exact native ID");
    const flags = c.slice(4);
    if (flags.some((x) => x !== "✓" && x !== "✗")) throw new Error("Changed inclusion marker");
    const included = plans.filter((_, k) => flags[k] === "✓");
    const isText = requiredValue(c[1]).startsWith("文本生成");
    output.push({
      id,
      plans: included,
      status: "available",
      conditions: {
        route_ids: isText ? ["agent-plan-tools"] : [],
        endpoint_family_raw: requiredValue(c[1]),
        raw_model_cell: requiredValue(c[2]),
        length_limits_raw: requiredValue(c[3]),
        retirement_pending: requiredValue(c[2]).includes("即将下线"),
        supported_ai_tools_only: isText || c[1] === "向量化",
        nontext_transport_unqualified: !isText,
      },
      evidence: [
        {
          url: u,
          locator: `Supported models and Harness matrix; model row ${i}; exact ✓/✗ columns`,
        },
      ],
    });
  }
  return output;
}
function kimi(bodies: Record<string, string>): Extracted[] {
  const u = "https://www.kimi.com/code/docs/en/kimi-code/models.html",
    membership = "https://www.kimi.com/code/docs/en/kimi-code/membership.html";
  const docs = root(body(bodies, u)),
    tables = tags(docs, "table").map(tableRows);
  const candidates = tables.filter((rows) => rows[0]?.[0] === "Model ID");
  if (candidates.length !== 1) throw new Error("Missing native-ID matrix");
  const matrix = requiredValue(candidates[0]),
    ids = requiredValue(matrix[0]).slice(1);
  const rows = new Map(matrix.slice(1).map((row) => [requiredValue(row[0]), row.slice(1)]));
  const newPlans = rows.get("Availability (new plans)"),
    legacyPlans = rows.get("Availability (legacy plans)");
  if (
    !newPlans ||
    !legacyPlans ||
    newPlans.length !== ids.length ||
    legacyPlans.length !== ids.length
  )
    throw new Error("Changed availability matrix");
  const membershipDoc = text(root(body(bodies, membership)));
  must(membershipDoc, "Legacy plans purchased before the new plans launched remain usable.");
  function qualifier(value: string): {
    minimum: string;
    context_minimum: string | null;
    raw: string;
  } {
    const m = value.match(/^([A-Za-z]+) and above(?: 1M context for ([A-Za-z]+) and above)?$/);
    if (!m) throw new Error(`Unqualified availability syntax: ${value}`);
    return { minimum: requiredValue(m[1]), context_minimum: m[2] ?? null, raw: value };
  }
  return ids.map((id, i) => {
    const n = qualifier(requiredValue(newPlans[i])),
      l = qualifier(requiredValue(legacyPlans[i]));
    return {
      id,
      plans: unique([
        n.minimum,
        l.minimum,
        ...(n.context_minimum ? [n.context_minimum] : []),
        ...(l.context_minimum ? [l.context_minimum] : []),
      ]),
      status: "unknown",
      conditions: {
        route_ids: ["kimi-code-cli", "kimi-code-plan-global-kimi-code-cli"],
        new_plan_minimum: n.minimum,
        legacy_plan_minimum: l.minimum,
        new_plan_1m_context_minimum: n.context_minimum,
        legacy_plan_1m_context_minimum: l.context_minimum,
        raw_new_availability: n.raw,
        raw_legacy_availability: l.raw,
        complete_plan_ladder_unverified: true,
        thinking_raw: rows.get("Reasoning")?.[i] ?? "",
        context_raw: rows.get("Context window")?.[i] ?? "",
        speed_raw: rows.get("Speed")?.[i] ?? "",
      },
      evidence: [
        { url: u, locator: `Model Overview column ${i}; Availability (new plans)/(legacy plans)` },
        { url: membership, locator: "Membership Tiers comparison; legacy plans remain usable" },
      ],
    };
  });
}
function rayline(bodies: Record<string, string>): Extracted[] {
  const u = "https://docs.rayline.ai/arc/pricing.md",
    billing = "https://docs.rayline.ai/platform/billing.md",
    plansUrl = "https://docs.rayline.ai/workshop/pricing/plans.md",
    modelsUrl = "https://docs.rayline.ai/arc/models.md";
  const md = body(bodies, u),
    bill = body(bodies, billing);
  must(
    bill,
    "A workspace linked for Workshop billing uses that organization's Workshop credits instead of a Rayline prepaid balance.",
  );
  const table = markdownTable(body(bodies, plansUrl), "Plans");
  const price = table.find((row) => plain(row[0] ?? "") === "Price");
  if (!price) throw new Error("No plan price row");
  const plans = requiredValue(table[0])
    .slice(1)
    .filter((_, i) => price[i + 1]?.includes("/month"));
  if (!plans.length) throw new Error("No monthly plans");
  const output: Extracted[] = [];
  function section(heading: string): string {
    const lines = md.split(/\r?\n/);
    const i = lines.findIndex((line) => line === `## ${heading}`);
    if (i < 0) throw new Error(`Missing model section ${heading}`);
    const rest = lines.slice(i + 1),
      end = rest.findIndex((line) => /^## /.test(line));
    return (end < 0 ? rest : rest.slice(0, end)).join("\n");
  }
  for (const heading of ["ARC Dynamic", "Decisions API"]) {
    const ids = unique(
      [...section(heading).matchAll(/`(arc-[a-z0-9.-]+)`/g)].map((m) => requiredValue(m[1])),
    );
    if (!ids.length) throw new Error(`No native IDs in section ${heading}`);
    for (const id of ids)
      output.push({
        id,
        plans,
        status: "available",
        conditions: {
          route_ids: heading === "ARC Dynamic" ? ["linked-api"] : [],
          endpoint_family: heading === "ARC Dynamic" ? "generation" : "decisions",
          linked_workshop_billing_required: true,
          separate_transport_contract: heading === "Decisions API",
          data_mode: id.includes("-contributor-")
            ? "contributor"
            : id.includes("-zdr-")
              ? "zdr"
              : "standard",
          approval_required: id.includes("-zdr-"),
        },
        evidence: [
          { url: u, locator: `${heading} section exact inline model ID` },
          { url: billing, locator: "Which balance pays; linked Workshop funding" },
          { url: plansUrl, locator: "Plans monthly Price row" },
        ],
      });
  }
  const preset = body(bodies, modelsUrl);
  const modelLine = preset.split(/\r?\n/).find((line) => /^\| Model ID \|/.test(line));
  if (!modelLine) throw new Error("No preset ID row");
  for (const id of unique([...modelLine.matchAll(/`([^`]+)`/g)].map((m) => requiredValue(m[1]))))
    output.push({
      id,
      plans,
      status: "available",
      conditions: {
        route_ids: ["linked-api"],
        endpoint_family: "generation",
        linked_workshop_billing_required: true,
      },
      evidence: [
        { url: modelsUrl, locator: "Model ID row; use in first-party API requests" },
        { url: billing, locator: "Which balance pays; linked Workshop funding" },
        { url: plansUrl, locator: "Plans monthly Price row" },
      ],
    });
  const privacyUrl = "https://docs.rayline.ai/platform/data-privacy.md";
  const privacy = body(bodies, privacyUrl);
  const modeTable = markdownTable(privacy, "ARC model IDs choose the data mode");
  if (JSON.stringify(modeTable[0]) !== JSON.stringify(["Model IDs", "Data mode"]))
    throw new Error("Changed data-mode table");
  for (const cells of modeTable.slice(1)) {
    for (const match of requiredValue(cells[0]).matchAll(/`([^`]+)`/g)) {
      const id = requiredValue(match[1]);
      let found = output.find((row) => row.id === id);
      if (!found) {
        found = {
          id,
          plans,
          status: "available",
          conditions: {
            route_ids: ["linked-api"],
            endpoint_family: "generation",
            linked_workshop_billing_required: true,
          },
          evidence: [
            { url: billing, locator: "Which balance pays; linked Workshop funding" },
            { url: plansUrl, locator: "Plans monthly Price row" },
          ],
        };
        output.push(found);
      }
      requiredValue(found.conditions).data_mode = requiredValue(cells[1]);
      requiredValue(found.conditions).approval_required = cells[1] === "Zero data retention";
      requiredValue(found.conditions).organization_can_disable_contributor =
        cells[1] === "Contributor";
      found.evidence.push({
        url: privacyUrl,
        locator: "ARC model IDs choose the data mode table; exact native ID",
      });
      if (cells[1] === "Zero data retention") found.status = "unknown";
    }
  }
  for (const found of output)
    if (found.id.includes("-zdr-")) {
      found.status = "unknown";
      found.evidence.push({
        url: privacyUrl,
        locator: "All ZDR use requires sales approval, including Decisions",
      });
    }
  return output;
}
function empirio(bodies: Record<string, string>): Extracted[] {
  const u = "https://empiriolabs.ai/pricing",
    api = "https://api.empiriolabs.ai/v1/models",
    docsUrl = "https://docs.empiriolabs.ai/plans";
  const pricing = root(body(bodies, u)),
    catalog = obj(json(bodies, api));
  if (catalog.object !== "list") throw new Error("Changed API list");
  const ids = new Set(
    arr(catalog.data)
      .map(obj)
      .map((row) => str(row.id)),
  );
  const details = tags(pricing, "details").filter((d) =>
    (attr(d, "class") ?? "").split(" ").includes("empirio-plans-pool"),
  );
  if (details.length !== 2) throw new Error("Changed pool section count");
  const planCards = all(pricing, (n) =>
    (attr(n, "class") ?? "").split(" ").includes("empirio-plans-mcard"),
  );
  const planNames = unique(
    planCards
      .filter((card) => text(card).includes("Weekly allowances"))
      .flatMap((card) =>
        all(card, (n) => (attr(n, "class") ?? "").split(" ").includes("empirio-plans-mname")).map(
          text,
        ),
      ),
  );
  if (!planNames.length) throw new Error("Missing subscription plan names");
  const output = new Map<string, Extracted>();
  for (const pool of details) {
    const heading = tags(pool, "summary")[0];
    if (!heading) throw new Error("Missing pool heading");
    const headingText = text(heading),
      count = headingText.match(/(\d+) models$/)?.[1];
    if (!count) throw new Error("Missing pool count");
    const links = tags(pool, "a").filter((a) =>
      (attr(a, "href") ?? "").startsWith("https://empiriolabs.ai/models/"),
    );
    if (links.length !== Number(count)) throw new Error("Pool count mismatch");
    for (const link of links) {
      const href = str(attr(link, "href")),
        id = href.slice("https://empiriolabs.ai/models/".length);
      if (!ids.has(id)) throw new Error(`No exact native ID match ${id}`);
      const entry = {
        pool: headingText,
        label: text(link),
        href,
        variant_parameters_unresolved: /\(Variant \d+\)|\(Priority\)/.test(text(link)),
      };
      const prior = output.get(id);
      if (prior) {
        (requiredValue(prior.conditions).pool_entries as Json[]).push(entry);
        continue;
      }
      output.set(id, {
        id,
        plans: [],
        status: "unknown",
        conditions: {
          route_ids: [],
          public_ui_subscription_plans: planNames,
          pool_entries: [entry],
          api_allowance_funding_unverified: true,
        },
        evidence: [
          { url: u, locator: `details.empirio-plans-pool; exact model href ${href}` },
          { url: api, locator: `$.data[id=${id}]` },
          {
            url: docsUrl,
            locator: "Allowance versus partially included or separately billed model usage",
          },
        ],
      });
    }
  }
  return [...output.values()];
}
function volcLegacy(bodies: Record<string, string>): Extracted[] {
  const u = "https://docs.volcengine.com/docs/ark/coding-plan-personal-get-started?lang=zh",
    overview = "https://docs.volcengine.com/docs/ark/coding-plan-personal-plan-overview?lang=zh",
    docs = root(body(bodies, u)),
    index = root(body(bodies, overview));
  const panels = all(docs, (n) =>
    (attr(n, "class") ?? "").split(" ").includes("doc-tabs-editable"),
  ).filter((n) => text(n).includes("支持配置的 Model Name："));
  if (panels.length !== 1) throw new Error("Missing/ambiguous model-name panel");
  must(text(docs), "支持使用全小写格式");
  const planRows = tableByHeaders(index, ["套餐", "适用场景"]);
  const planNames = planRows.map((c) => requiredValue(c[0]).replace(/ 套餐$/, ""));
  const models: Extracted[] = [];
  for (const li of tags(requiredValue(panels[0]), "li")) {
    const code = all(li, (n) => (attr(n, "class") ?? "").split(" ").includes("inline-code"))[0];
    if (!code) throw new Error("Missing exact native model ID");
    const id = clean(rawText(code));
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) throw new Error("Unexpected request ID");
    models.push({
      id,
      plans: [],
      status: "unknown",
      conditions: {
        route_ids: [],
        documented_plan_names: planNames,
        plan_to_model_scope_unverified: true,
        ai_coding_tools_only: true,
        raw_qualifiers: text(li),
      },
      evidence: [
        { url: u, locator: `Configure Model Name tab; explicit model list; ID=${id}` },
        { url: overview, locator: "Plan table and separate supported-model overview" },
      ],
    });
  }
  const selector = all(docs, (n) =>
    (attr(n, "class") ?? "").split(" ").includes("doc-tabs-title-item"),
  )
    .map(text)
    .find((t) => t.includes("(控制台管理)"));
  const selectorId = selector?.match(/配置 ([a-z0-9-]+) \(控制台管理\)/)?.[1];
  if (!selectorId) throw new Error("Missing console selector");
  models.push({
    id: selectorId,
    plans: [],
    status: "unknown",
    conditions: {
      route_ids: [],
      documented_plan_names: planNames,
      console_managed_selector: true,
      not_a_fixed_model: true,
      ai_coding_tools_only: true,
    },
    evidence: [{ url: u, locator: "Console-managed configuration tab title" }],
  });
  return models;
}
export function extract(subscriptionId: string, bodies: Record<string, string>): Extracted[] {
  let rows: Extracted[];
  switch (subscriptionId) {
    case "augure-subscription":
      rows = augure(bodies);
      break;
    case "io-net":
      rows = ioNet(bodies);
      break;
    case "synthetic-subscription":
      rows = synthetic(bodies);
      break;
    case "volcengine":
      rows = volcengine(bodies);
      break;
    case "kimi":
      rows = kimi(bodies);
      break;
    case "rayline":
      rows = rayline(bodies);
      break;
    case "empiriolabs-subscription":
      rows = empirio(bodies);
      break;
    case "volcengine-ark-coding-plan":
      rows = volcLegacy(bodies);
      break;
    default:
      throw new Error(`No qualified public source for ${subscriptionId}`);
  }
  if (!rows.length) throw new Error("Empty extraction result");
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error("Duplicate native ID");
  return rows;
}
