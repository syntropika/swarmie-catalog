import { parse } from "parse5";
import { requiredValue } from "./validation.ts";
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };
export type Row = {
  id: string;
  plans: string[];
  status: "available" | "unavailable" | "unknown";
  conditions?: Record<string, JsonValue>;
  api?: Record<string, string>;
  evidence: {
    url: string;
    locator: string;
  }[];
};
type Obj = Record<string, unknown>;
type Node = {
  tagName?: string;
  nodeName?: string;
  value?: string;
  childNodes?: Node[];
  parentNode?: Node;
};
function need(test: unknown, message: string): asserts test {
  if (!test) throw new Error(message);
}
const object = (v: unknown): Obj => {
  need(v !== null && typeof v === "object" && !Array.isArray(v), "Expected object");
  return v as Obj;
};
const array = (v: unknown): unknown[] => {
  need(Array.isArray(v), "Expected array");
  return v;
};
const string = (v: unknown): string => {
  need(typeof v === "string" && v.length > 0, "Expected nonempty string");
  return v;
};
const text = (n: Node): string =>
  ["script", "style"].includes(n.tagName ?? "")
    ? ""
    : n.nodeName === "#text"
      ? (n.value ?? "")
      : (n.childNodes ?? []).map(text).join(" ");
const descendants = (n: Node, tags: string[]): Node[] => [
  ...(tags.includes(n.tagName ?? "") ? [n] : []),
  ...(n.childNodes ?? []).flatMap((c) => descendants(c, tags)),
];
const compact = (s: string): string => s.replace(/\s+/g, " ").trim();
const htmlText = (s: string): string => compact(text(parse(s) as unknown as Node));
const clean = (s: string): string => s.replace(/^[ \t]*(?:>[ \t]*)+/gm, "");
const code = (s: string): string | null => /^`([^`]+)`$/.exec(s.trim())?.[1] ?? null;
const plain = (s: string): string => s.replace(/\*\*/g, "").replace(/`/g, "").trim();
function section(s: string, heading: string): string {
  const lines = clean(s).split("\n");
  const i = lines.findIndex(
    (l) => /^#{1,6} /.test(l) && l.replace(/^#+\s*/, "").trim() === heading,
  );
  need(i >= 0, `Missing section ${heading}`);
  const level = requiredValue(/^#+/.exec(requiredValue(lines[i])))[0].length;
  let end = i + 1;
  let fenced = false;
  while (end < lines.length) {
    const line = requiredValue(lines[end]);
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      end++;
      continue;
    }
    const h = fenced ? null : /^(#+) /.exec(line);
    if (h && requiredValue(h[1]).length <= level) break;
    end++;
  }
  return lines.slice(i + 1, end).join("\n");
}
function tables(s: string): string[][][] {
  const groups: string[][][] = [];
  let current: string[][] = [];
  for (const line of clean(s).split("\n")) {
    if (/^\s*\|.*\|\s*$/.test(line))
      current.push(
        line
          .trim()
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim()),
      );
    else if (current.length) {
      if (current.length > 1) groups.push(current);
      current = [];
    }
  }
  if (current.length > 1) groups.push(current);
  return groups
    .filter((g) => requiredValue(g[1]).every((v) => /^:?-+:?$/.test(v.replace(/\s+/g, ""))))
    .map((g) => [requiredValue(g[0]), ...g.slice(2)]);
}
function table(s: string, headers: string[]): string[][] {
  const matches = tables(s).filter((t) =>
    headers.every((h, i) => plain(requiredValue(requiredValue(t[0])[i])) === h),
  );
  need(matches.length === 1, `Expected one table with headers ${headers.join(", ")}`);
  return requiredValue(matches[0]);
}
function unique(rows: Row[]): Row[] {
  need(rows.length > 0, "Empty extraction");
  need(new Set(rows.map((r) => r.id)).size === rows.length, "Duplicate model IDs");
  for (const r of rows) {
    need(r.plans.length > 0, "Missing plan grant");
    need(new Set(r.plans).size === r.plans.length, "Duplicate plan names");
  }
  return rows;
}
function assertPlans(s: string, expected: string[]): string[] {
  const content = htmlText(s);
  for (const name of expected)
    need(
      new RegExp(`(?:^|\\W)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\W)`).test(content),
      `Missing plan ${name}`,
    );
  return expected;
}
const evidence = (url: string, locator: string) => ({ url, locator });
function extractUnscoped(subscriptionId: string, bodies: Record<string, string>): Row[] {
  const body = (url: string): string => {
    need(typeof bodies[url] === "string", `Missing source ${url}`);
    return requiredValue(bodies[url]);
  };
  if (subscriptionId === "kilo-subscription") {
    const url = "https://ai-gateway.kilo.ai/api/v1/models";
    const planUrl = "https://kilo.ai/pricing/kilo-pass";
    const docs = "https://kilo.ai/docs/gateway/models-and-providers";
    const plans = assertPlans(body(planUrl), ["Starter", "Pro", "Expert"]);
    const p = htmlText(body(planUrl));
    need(
      p.includes("Your balance works with every model on Kilo") && p.includes("Kilo Gateway"),
      "Missing full-catalog Pass scope",
    );
    need(
      htmlText(body(docs)).includes(url) &&
        htmlText(body(docs)).includes("No authentication is required"),
      "Catalog not publicly documented",
    );
    return unique(
      array(object(JSON.parse(body(url))).data).map((v) => {
        const m = object(v);
        const id = string(m.id);
        need(
          typeof m.isFree === "boolean" && typeof m.mayTrainOnYourPrompts === "boolean",
          "Missing model privacy/free qualifier",
        );
        return {
          id,
          plans,
          status: "available",
          conditions: {
            is_free: m.isFree,
            may_train_on_prompts: m.mayTrainOnYourPrompts,
            auto_routing: (m.autoRouting ?? null) as JsonValue,
            inference_provider_ids: (m.inference_provider_ids ?? []) as JsonValue,
            architecture: (m.architecture ?? {}) as JsonValue,
          },
          evidence: [
            evidence(url, `$.data[id=${id}]`),
            evidence(planUrl, "Your Kilo Balance, Your Rules > every model / Kilo Gateway"),
          ],
        };
      }),
    );
  }
  if (subscriptionId === "unorouter-subscription") {
    const url = "https://api.unorouter.com/api/pricing/catalog";
    const planUrl = "https://unorouter.com/en/pricing";
    const source = body(planUrl);
    const plans = assertPlans(source, ["Starter", "Pro", "Scale"]);
    const p = source.includes("Total lines:") ? source : htmlText(source);
    need(
      (p.match(/Use it on any model/g) ?? []).length === 3,
      "Each UnoRouter plan must explicitly cover any model",
    );
    return unique(
      array(object(JSON.parse(body(url))).models).map((v) => {
        const m = object(v);
        const id = string(m.model_name);
        need(
          typeof m.online === "boolean" && typeof m.is_free === "boolean",
          "Missing availability flags",
        );
        return {
          id,
          plans,
          status: m.online ? "available" : "unavailable",
          conditions: {
            type: string(m.type),
            is_free: m.is_free,
            provider_consent: (m.own_purpose ?? null) as JsonValue,
            supported_endpoint_types: (m.supported_endpoint_types ?? []) as JsonValue,
            weekly_credit_expiry: true,
          },
          evidence: [
            evidence(url, `$.models[model_name=${id}]`),
            evidence(planUrl, "Starter / Pro / Scale > Use it on any model"),
          ],
        };
      }),
    );
  }
  if (subscriptionId === "zenifra-ai-plans") {
    const url = "https://ai.zenifra.com/v1/models";
    const planUrl = "https://docs.zenifra.com/pt/docs/ai/plans";
    const doc = "https://docs.zenifra.com/pt/docs/ai";
    const plans = assertPlans(body(planUrl), ["Lite", "Standard", "Premium"]);
    const p = htmlText(body(planUrl));
    need(
      p.includes("Todos os planos incluem:") &&
        p.includes("todos os modelos do catálogo da Zenifra"),
      "Missing full-catalog membership",
    );
    need(
      p.includes("O Premium não tem a janela de 5 horas") && p.includes("Janela semanal"),
      "Missing plan window qualifiers",
    );
    need(htmlText(body(doc)).includes(url), "Missing documented public catalog");
    return unique(
      array(object(JSON.parse(body(url))).data).map((v) => {
        const m = object(v);
        const id = string(m.id);
        return {
          id,
          plans,
          status: "available",
          conditions: {
            member_plan_key: true,
            separate_payg_key: true,
            usage_windows: {
              Lite: ["five-hour", "weekly"],
              Standard: ["five-hour", "weekly"],
              Premium: ["weekly"],
            },
            capabilities: (m.capabilities ?? {}) as JsonValue,
            supported_operations: (m.supported_operations ?? []) as JsonValue,
          },
          evidence: [
            evidence(url, `$.data[id=${id}]`),
            evidence(planUrl, "Todos os planos incluem / Usar a chave do plano"),
          ],
        };
      }),
    );
  }
  if (subscriptionId === "agnes" || subscriptionId === "agnes-token-plan-retained") {
    const planUrl = "https://agnes-ai.com/en/docs/tokenplan.md";
    const priceUrl = "https://agnes-ai.com/en/docs/pricing.md";
    const p = clean(body(planUrl));
    if (subscriptionId === "agnes-token-plan-retained") {
      const t = table(section(p, "Existing plan quotas"), ["Plan"]);
      const plans = t.slice(1).map((r) => plain(requiredValue(r[0])));
      need(
        p.includes("Existing Token Plan users retain their benefits"),
        "Missing retained-plan scope",
      );
      return unique(
        requiredValue(t[0])
          .slice(1)
          .map((c, i) => {
            const id = code(c);
            need(id, "Expected native ID column");
            return {
              id,
              plans,
              status: "available",
              conditions: {
                retained_subscription: true,
                new_purchase: "capacity-dependent",
                quotas: Object.fromEntries(
                  t
                    .slice(1)
                    .map((r) => [plain(requiredValue(r[0])), plain(requiredValue(r[i + 1]))]),
                ),
                separate_key_pool: true,
              },
              evidence: [evidence(planUrl, `Existing plan quotas > ${id}`)],
            };
          }),
      );
    }
    const discounts = table(section(p, "Model discounts"), ["Model scope"]);
    const plans = requiredValue(discounts[0]).slice(1).map(plain);
    need(
      plans.length > 0 && p.includes("All currently available models"),
      "Missing full Agent Plan scope",
    );
    const rows: Row[] = [];
    for (const h of ["Text models", "Image models", "Video models"]) {
      const sec = section(body(priceUrl), h);
      const doc = parse(sec) as unknown as Node;
      for (const t of descendants(doc, ["table"])) {
        const headers = descendants(t, ["th"]).map((n) => compact(text(n)));
        if (headers[0] !== "Model") continue;
        for (const tr of descendants(t, ["tr"])) {
          const cells = (tr.childNodes ?? []).filter((n) => n.tagName === "td");
          if (!cells.length) continue;
          const cell = compact(text(requiredValue(cells[0])));
          const match = /`([^`]+)`/.exec(cell);
          if (!match || cell.includes("Coming soon")) continue;
          const id = requiredValue(match[1]);
          rows.push({
            id,
            plans,
            status: "available",
            conditions: {
              modality_section: h,
              credits_at_list_price: true,
              default_trial_offers_apply: false,
              model_discounts: Object.fromEntries(
                discounts.slice(1).map((r) => [plain(requiredValue(r[0])), r.slice(1).map(plain)]),
              ),
            },
            evidence: [
              evidence(priceUrl, `${h} > Model column > ${id}`),
              evidence(planUrl, "Agent Plan > All currently available models / Model discounts"),
            ],
          });
        }
      }
    }
    return unique(rows);
  }
  if (subscriptionId === "morph-plans") {
    const url = "https://www.morphllm.com/api/models/json?prices=list";
    const planUrl = "https://docs.morphllm.com/ultra-plan.md";
    const p = body(planUrl);
    need(/^# Ultra plan$/m.test(p), "Missing Ultra plan title");
    need(
      p.includes("serving your product's end users from it is not allowed") &&
        p.includes("A seat covers only the API keys its holder puts on it"),
      "Missing Ultra account restrictions",
    );
    const t = table(section(p, "What the plan covers"), ["Model", "API ID", "On the plan"]);
    const data = new Map(
      array(object(JSON.parse(body(url))).data).map((v) => {
        const m = object(v);
        return [string(m.id), m] as const;
      }),
    );
    const rows: Row[] = [];
    for (const r of t.slice(1)) {
      const id = code(requiredValue(r[1]));
      if (!id) {
        need(
          /Every other model/.test(requiredValue(r[0])) && /Per token/.test(requiredValue(r[2])),
          "Unknown no-ID coverage row",
        );
        continue;
      }
      need(requiredValue(r[2]).startsWith("No token meter"), "Unknown coverage marker");
      const limits = data.get(id)?.ultra_plan;
      need(limits && typeof limits === "object", "Included model lacks live limits");
      rows.push({
        id,
        plans: ["Ultra"],
        status: "available",
        conditions: {
          privileged_approval_required: requiredValue(r[2]).includes("privileged access"),
          ultra_plan: limits as JsonValue,
          external_end_users_allowed: false,
          assigned_seat_key_required_for_organization: true,
        },
        api: {
          "openai-chat-completions": "https://api.morphllm.com/v1/chat/completions",
          "anthropic-messages": "https://api.morphllm.com/v1/messages",
        },
        evidence: [
          evidence(planUrl, `What the plan covers > API ID ${id}`),
          evidence(url, `$.data[id=${id}].ultra_plan`),
        ],
      });
    }
    for (const m of p.matchAll(/`([^`]+)` is an alias for `([^`]+)`/g)) {
      const target = rows.find((r) => r.id === m[2]);
      need(target, "Alias target lacks subscription grant");
      rows.push({
        ...target,
        id: requiredValue(m[1]),
        conditions: { ...target.conditions, alias_of: requiredValue(m[2]) },
        evidence: [...target.evidence, evidence(planUrl, `Explicit alias ${m[1]} -> ${m[2]}`)],
      });
    }
    const included = new Set(rows.map((r) => r.id));
    const unresolved = [...data]
      .filter(([id, m]) => m.ultra_plan && !included.has(id))
      .map(([id]) => id);
    for (const r of rows)
      r.conditions = { ...r.conditions, feed_limits_without_explicit_membership: unresolved };
    return unique(rows);
  }
  if (
    [
      "stepfun-step-plan",
      "stepfun-step-plan-cn",
      "stepfun-ai-subscription",
      "stepfun-step-plan-global",
    ].includes(subscriptionId)
  ) {
    const china = ["stepfun-step-plan", "stepfun-step-plan-cn"].includes(subscriptionId);
    const base = china
      ? "https://platform.stepfun.com/docs/zh/step-plan/"
      : "https://platform.stepfun.ai/docs/en/step-plan/";
    const overview = `${base}overview.md`;
    const reasoning = `${base}integrations/reasoning-api.md`;
    const pricing = china ? `${base}pricing.md` : overview;
    const audio = `${base}integrations/audio-api.md`;
    const tierTable = table(
      section(body(pricing), china ? "套餐档位" : "Plan tiers"),
      china ? ["档位", "月度 Credit"] : ["Plan", "Best for"],
    );
    const plans = tierTable.slice(1).map((r) => plain(requiredValue(r[0])));
    need(plans.length > 0, "Missing Step Plan tiers");
    const source = body(reasoning);
    const modelTable = table(
      section(source, china ? "支持的模型" : "Supported Models"),
      china ? ["模型", "说明"] : ["Model", "Description"],
    );
    const paths = table(
      section(source, china ? "接口路径" : "Endpoint Paths"),
      china
        ? ["能力", "请求方式", "Step Plan 路径"]
        : ["Capability", "Request Method", "Step Plan Path"],
    );
    const api: Record<string, string> = {};
    for (const r of paths.slice(1)) {
      const u = code(requiredValue(r[2]));
      need(u && /^https:/.test(u), "Invalid Step API URL");
      if (/chat\/completions$/.test(u)) api["openai-chat-completions"] = u;
      else if (/messages$/.test(u)) api["anthropic-messages"] = u;
      else throw new Error("Unknown reasoning endpoint");
    }
    need(
      api["openai-chat-completions"] && api["anthropic-messages"],
      "Incomplete Step reasoning paths",
    );
    const conditions: Record<string, JsonValue> = {
      region: china ? "china" : "global",
      standard_payg_channel_is_separate: true,
      allowances: tierTable.slice(1).map((r) => r.map(plain)),
    };
    if (china) {
      const peak = section(body(pricing), "分时段扣减");
      const namedModel = /通过 Step Plan 调用 (.+?) 时/.exec(peak)?.[1];
      need(
        namedModel &&
          peak.includes("2 倍") &&
          peak.includes("历史订阅") &&
          peak.includes("周一至周五"),
        "Missing peak/historical qualifiers",
      );
      const periods = [...peak.matchAll(/\d{2}:\d{2}–\d{2}:\d{2}/g)].map((m) => m[0]);
      need(periods.length > 0, "Missing peak windows");
      conditions.peak_billing = {
        model_name: namedModel,
        timezone: "Asia/Shanghai",
        weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        windows: periods,
        multiplier: 2,
        historical_subscriptions_may_be_exempt: true,
      };
    }
    const rows: Row[] = modelTable.slice(1).map((r) => {
      const id = code(requiredValue(r[0]));
      need(id, "Native reasoning ID missing");
      return {
        id,
        plans,
        status: "available",
        conditions: { ...conditions },
        api,
        evidence: [
          evidence(reasoning, `Supported Models > ${id}`),
          evidence(pricing, china ? "套餐档位 / 分时段扣减" : "Plan tiers"),
        ],
      };
    });
    if (china) {
      const modelRows = table(section(body(audio), "支持的模型"), ["类别", "模型", "说明"]);
      for (const m of modelRows.slice(1)) {
        const id = code(requiredValue(m[1]));
        need(id, "Audio native ID missing");
        const category = plain(requiredValue(m[0]));
        const seg = section(body(audio), category);
        need(seg.includes(id), `Audio section ${category} does not establish native ID ${id}`);
        const endpointRows = table(section(seg, "接口路径"), [
          "能力",
          "请求方式",
          "Step Plan 路径",
        ]);
        const endpoints: Record<string, string> = {};
        for (const e of endpointRows.slice(1)) {
          const u = code(requiredValue(e[2]));
          need(u && /^(https|wss):/.test(u), "Invalid audio endpoint");
          if (/\/chat\/completions$/.test(u)) endpoints["openai-chat-completions"] = u;
          else if (/\/audio\/speech$/.test(u)) endpoints["stepfun-audio-speech"] = u;
          else if (/\/audio\/asr\/sse$/.test(u)) endpoints["stepfun-asr-sse"] = u;
          else if (/\/realtime\/audio$/.test(u)) endpoints["stepfun-audio-websocket"] = u;
          else if (/\/realtime$/.test(u)) endpoints["stepfun-realtime-websocket"] = u;
          else if (/\/audio\/voices(?:\/preview)?$/.test(u)) continue;
          else throw new Error("Unknown audio endpoint");
        }
        rows.push({
          id,
          plans,
          status: "available",
          conditions: {
            ...conditions,
            protocol_specific: true,
            modalities: seg.includes("仅支持 `text` 模态") ? ["text"] : ["audio"],
            asr_sse_only: seg.includes("仅可通过 HTTP + SSE"),
          },
          api: endpoints,
          evidence: [
            evidence(audio, `Supported Models / ${category} > ${id}`),
            evidence(pricing, "套餐档位"),
          ],
        });
      }
    } else {
      const supported = section(body(overview), "Supported models");
      for (const line of supported.split("\n")) {
        const match = /^\*\s+(?:\[)?`([^`]+)`/.exec(line);
        if (!match || rows.some((r) => r.id === match[1])) continue;
        need(/TTS|speech recognition/i.test(line), "Unexpected unqualified overview-only model");
        rows.push({
          id: requiredValue(match[1]),
          plans,
          status: "unknown",
          conditions: {
            ...conditions,
            subscription_membership_documented: true,
            request_path_qualified: false,
            limitation: "Global audio integration guide returns 404; do not copy China routes.",
          },
          evidence: [evidence(overview, `Supported models > ${match[1]}`)],
        });
      }
    }
    return unique(rows);
  }
  if (subscriptionId === "sambanova") {
    const url = "https://docs.sambanova.ai/docs/en/models/sambacloud-models.md";
    const planUrl = "https://cloud.sambanova.ai/plans";
    const p = htmlText(body(planUrl));
    const scope = p.split("Enterprise")[1] ?? "";
    need(
      scope.includes("Access to all Production & Preview models") &&
        scope.includes("Subscription based pricing"),
      "Missing enterprise subscription model scope",
    );
    const rows: Row[] = [];
    for (const group of ["Production models", "Preview models"]) {
      const source = section(body(url), group);
      const t = table(source, ["Developer", "Model ID", "Context length", "Supported modalities"]);
      for (const m of t.slice(1)) {
        const id = code(requiredValue(m[1]));
        need(id, "Native SambaNova ID missing");
        rows.push({
          id,
          plans: ["Enterprise"],
          status: "available",
          conditions: {
            stage: group.startsWith("Preview") ? "preview" : "production",
            production_use_allowed: !group.startsWith("Preview"),
            context: plain(requiredValue(m[2])),
            modalities: plain(requiredValue(m[3])),
            enterprise_contract_required: true,
            on_request_models_are_addons: true,
          },
          evidence: [
            evidence(url, `${group} > Model ID ${id}`),
            evidence(planUrl, "Enterprise > Access to all Production & Preview models"),
          ],
        });
      }
    }
    return unique(rows);
  }
  if (subscriptionId === "cerebras-code") {
    const url = "https://www.cerebras.ai/code";
    const doc = "https://inference-docs.cerebras.ai/models/zai-glm-47.md";
    const tree = parse(body(url)) as unknown as Node;
    const cards = descendants(tree, ["h2"]).filter((n) =>
      n.childNodes?.some((c) => c.tagName === "span"),
    );
    const plans = cards.map((n) => compact(text(n)));
    const soldOut = cards
      .filter((n) => /sold out/i.test(compact(text(n.parentNode?.parentNode ?? n))))
      .map((n) => compact(text(n)));
    need(plans.length > 0, "Missing Code tier cards");
    const codeBody = htmlText(body(url));
    const family = /Cerebras runs (GLM\s*[\d.]+)/.exec(codeBody)?.[1];
    need(family, "Missing Code model family");
    const d = body(doc);
    need(/^# Deprecations$/m.test(d), "Expected explicit deprecation conflict");
    const native = [...d.matchAll(/\*\*Deprecated `([^`]+)`\*\*/g)]
      .map((m) => requiredValue(m[1]))
      .filter((id) => id.endsWith(family.toLowerCase().replace(/\s+/g, "-")));
    need(native.length === 1, "No exact historic native ID for the marketing family");
    return unique(
      native.map((id) => ({
        id,
        plans,
        status: "unknown",
        conditions: {
          marketing_model_name: family,
          model_documentation_deprecated: true,
          sold_out_plans: soldOut,
          conflict:
            "Code marketing still names model, but current official model document redirects to Deprecations.",
        },
        evidence: [evidence(url, "Code plan cards"), evidence(doc, `Deprecated ${id}`)],
      })),
    );
  }
  throw new Error(`Unsupported public source ${subscriptionId}`);
}
export function extract(subscriptionId: string, bodies: Record<string, string>): Row[] {
  const rows = extractUnscoped(subscriptionId, bodies);
  const stepRoutes: Record<string, string> = {
    "stepfun-step-plan": "step-plan-endpoint",
    "stepfun-step-plan-cn": "stepfun-step-plan-api-cn",
    "stepfun-ai-subscription": "direct-model-subscription",
    "stepfun-step-plan-global": "stepfun-step-plan-api-global",
  };
  for (const row of rows) {
    const c = row.conditions ?? {};
    let routes: string[] = [];
    if (row.status === "available") {
      if (subscriptionId === "agnes" && c.modality_section === "Text models") {
        const u = "https://agnes-ai.com/en/docs/quickstart";
        need(
          (bodies[u] ?? "").includes("https://apihub.agnes-ai.com/v1/chat/completions"),
          "Missing documented Agnes text API",
        );
        routes = ["api"];
        row.api = { "openai-chat-completions": "https://apihub.agnes-ai.com/v1/chat/completions" };
        row.evidence.push(evidence(u, "Quickstart > text completion endpoint"));
      }
      if (subscriptionId === "kilo-subscription") {
        const architecture = object(c.architecture);
        const out = array(architecture.output_modalities);
        if (out.length === 1 && out[0] === "text") routes = ["direct-model-subscription"];
      }
      if (
        subscriptionId === "zenifra-ai-plans" &&
        array(c.supported_operations).includes("/v1/chat/completions")
      )
        routes = ["zenifra-ai-api"];
      if (subscriptionId === "morph-plans") routes = ["morph-api"];
      if (subscriptionId === "sambanova") {
        const u = "https://docs.sambanova.ai/docs/en/get-started/api-keys-urls.md";
        const sectionText = section(bodies[u] ?? "", "SambaCloud");
        const endpoint = /https:\/\/[^\s`]+\/chat\/completions/.exec(sectionText)?.[0];
        need(endpoint, "Missing SambaCloud Chat Completions endpoint");
        routes = ["api"];
        row.api = { "openai-chat-completions": endpoint };
        row.evidence.push(evidence(u, "SambaCloud > Chat completion endpoint"));
      }
      if (
        stepRoutes[subscriptionId] &&
        !c.protocol_specific &&
        row.api?.["openai-chat-completions"]
      )
        routes = [requiredValue(stepRoutes[subscriptionId])];
    }
    row.conditions = { ...c, route_ids: routes, request_protocol_qualified: routes.length > 0 };
  }
  return rows;
}
