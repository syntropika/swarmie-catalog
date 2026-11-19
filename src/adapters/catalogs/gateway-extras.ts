import { parse } from "parse5";
import type { JsonValue, Row } from "./gateway-plans.ts";
import { requiredValue } from "./validation.ts";

type Obj = Record<string, unknown>;
type Node = {
  tagName?: string;
  nodeName?: string;
  value?: string;
  childNodes?: Node[];
  parentNode?: Node;
  attrs?: {
    name: string;
    value: string;
  }[];
};
function need(test: unknown, message: string): asserts test {
  if (!test) throw new Error(message);
}
function object(v: unknown): Obj {
  need(v !== null && typeof v === "object" && !Array.isArray(v), "Expected object");
  return v as Obj;
}
function array(v: unknown): unknown[] {
  need(Array.isArray(v), "Expected array");
  return v;
}
function string(v: unknown): string {
  need(typeof v === "string" && v.length > 0, "Expected string");
  return v;
}
const compact = (s: string) => s.replace(/\s+/g, " ").trim();
const text = (n: Node): string =>
  ["script", "style"].includes(n.tagName ?? "")
    ? ""
    : n.nodeName === "#text"
      ? (n.value ?? "")
      : (n.childNodes ?? []).map(text).join(" ");
const nodes = (n: Node, tags: string[]): Node[] => [
  ...(tags.includes(n.tagName ?? "") ? [n] : []),
  ...(n.childNodes ?? []).flatMap((c) => nodes(c, tags)),
];
const attr = (n: Node, k: string) => n.attrs?.find((a) => a.name === k)?.value;
const root = (s: string) => parse(s) as unknown as Node;
const contents = (s: string) => compact(text(root(s)));
const evidence = (url: string, locator: string) => ({ url, locator });
const headerText = (n: Node) =>
  compact(text(n))
    .replace(/\s*[↕↑↓]\s*/g, "")
    .trim();
function rowCells(n: Node): Node[] {
  return (n.childNodes ?? []).filter((c) => c.tagName === "td" || c.tagName === "th");
}
function tableRows(n: Node): Node[][] {
  return nodes(n, ["tr"])
    .map(rowCells)
    .filter((r) => r.length);
}
function findTable(n: Node, headers: string[]): Node[][] {
  const ts = nodes(n, ["table"])
    .map(tableRows)
    .filter(
      (r) =>
        r[0] && headers.every((h, i) => headerText(requiredValue(requiredValue(r[0])[i])) === h),
    );
  need(ts.length === 1, `Expected one table: ${headers.join(", ")}`);
  return requiredValue(ts[0]);
}
function listRows(rows: Row[]): Row[] {
  need(rows.length > 0, "Empty extraction");
  need(new Set(rows.map((r) => r.id)).size === rows.length, "Duplicate model IDs");
  return rows;
}
function jsonLd(n: Node): Obj[] {
  const out: Obj[] = [];
  function visit(v: unknown) {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
    } else if (v && typeof v === "object") {
      const o = object(v);
      out.push(o);
      for (const x of Object.values(o)) visit(x);
    }
  }
  for (const s of nodes(n, ["script"]).filter((s) => attr(s, "type") === "application/ld+json")) {
    const raw = (s.childNodes ?? []).map((c) => c.value ?? "").join("");
    visit(JSON.parse(raw));
  }
  return out;
}
function nameCell(n: Node): string {
  const links = nodes(n, ["a"]);
  return compact(text(links[0] ?? n))
    .replace(/\s+(?:\(Free\)|Free)$/, "")
    .trim();
}
function numericString(v: unknown): number {
  const s = string(v);
  need(/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s), "Invalid nonnegative price");
  const n = Number(s);
  need(Number.isFinite(n), "Invalid price");
  return n;
}
function extractUnscoped(subscriptionId: string, bodies: Record<string, string>): Row[] {
  const body = (u: string): string => {
    need(typeof bodies[u] === "string", `Missing source ${u}`);
    return requiredValue(bodies[u]);
  };
  if (subscriptionId === "inferall-subscription") {
    const u = "https://api.inferall.ai/v1/models",
      p = "https://inferall.ai/pricing",
      doc = "https://inferall.ai/docs",
      catalog = "https://www.inferall.ai/models";
    const t = contents(body(p));
    for (const clause of [
      "All 100+ models across every provider",
      "Everything in Pro included",
      "No premium-provider credit included",
      "NVIDIA NIM",
      "2,000 chat requests/day",
      "$20/month of premium-provider usage included",
    ])
      need(t.includes(clause), `Missing InferAll scope ${clause}`);
    const a = object(JSON.parse(body(u)));
    need(a.object === "list", "Wrong list envelope");
    const route = contents(body(doc));
    need(
      route.includes("prefix") && route.includes("X-Inferall-Routing") && route.includes("exact"),
      "Missing exact provider routing documentation",
    );
    const substituted = new Set(
      nodes(root(body(catalog)), ["tr"])
        .filter((r) => text(r).includes("served by a default model"))
        .flatMap((r) => nodes(r, ["code"]).map((c) => compact(text(c)))),
    );
    need(substituted.size > 0, "Missing documented default-model substitution qualifiers");
    return listRows(
      array(a.data).map((v) => {
        const m = object(v),
          id = string(m.id),
          price = object(m.pricing);
        const free = numericString(price.prompt) === 0 && numericString(price.completion) === 0;
        const replaced = substituted.has(id) || substituted.has(`${string(m.owned_by)}/${id}`);
        return {
          id,
          plans: free ? ["Starter", "Pro", "Capacity"] : ["Pro", "Capacity"],
          status: replaced ? "unknown" : "available",
          conditions: {
            documented_default_model_substitution: replaced,
            required_headers: { "X-Inferall-Routing": "exact" },
            actual_provider_and_model_response_must_be_confirmed: true,
            free_nim_classification_from_documented_zero_prices: free,
            starter_chat_requests_per_day: 2000,
            pro_premium_allowance_usd_per_month: 20,
            premium_overflow: "separately funded prepaid balance",
            capacity_reserved_concurrency_is_separate: true,
            full_multimodal_catalog_coverage: false,
            default_model_substitution_may_apply: true,
            model_identity_requires_account_route_confirmation: true,
          },
          evidence: [
            evidence(u, `$.data[id=${id}].pricing`),
            evidence(p, "Starter / Pro / Capacity scope and included-usage FAQ"),
            evidence(doc, "Provider prefixes and unpaid-account routing"),
            evidence(catalog, "Free NIM and default-model substitution descriptions"),
          ],
        };
      }),
    );
  }
  if (subscriptionId === "inference") {
    const u = "https://api.inference.net/v1/models",
      p = "https://inference.net/subscription/";
    const t = contents(body(p));
    need(
      t.includes("Operator") &&
        t.includes("Studio") &&
        t.includes("Hosted and provider model access") &&
        t.includes("Every model request draws from one shared balance"),
      "Missing ambiguous plan scope",
    );
    return listRows(
      array(object(JSON.parse(body(u))).data).map((v) => {
        const m = object(v),
          id = string(m.id);
        return {
          id,
          plans: [],
          status: "unknown",
          conditions: {
            candidate_plan_names: ["Operator", "Studio"],
            plan_membership_established: false,
            reason:
              "Shared Gateway credit is documented, but Operator and Studio model eligibility is not defined. A general API model list is not a subscription grant.",
          },
          evidence: [
            evidence(u, `$.data[id=${id}]`),
            evidence(p, "Operator / Studio / Hosted and provider model access"),
          ],
        };
      }),
    );
  }
  if (subscriptionId === "llmgateway-devpass") {
    const first = "https://devpass.llmgateway.io/models",
      plansUrl = "https://llmgateway.io/products/devpass",
      rules = "https://docs.llmgateway.io/learn/model-categories";
    const t = contents(body(plansUrl));
    need(
      t.includes("Lite, Pro, and Max") && t.includes("every plan includes"),
      "Missing all-plan DevPass scope",
    );
    const rd = root(body(rules));
    const rt = compact(text(rd));
    need(
      rt.includes("Provider pinning is not available on DevPass") &&
        rt.includes("rejected with a 403"),
      "Missing provider routing restriction",
    );
    const cap = findTable(rd, ["DevPass plan", "Premium fair-use cap (per week)"]);
    const daily = findTable(rd, ["DevPass plan", "Daily pacing allowance (per rolling 24h)"]);
    const plans = cap.slice(1).map((r) => compact(text(requiredValue(r[0]))));
    const caps = Object.fromEntries(
      cap
        .slice(1)
        .map((r) => [compact(text(requiredValue(r[0]))), compact(text(requiredValue(r[1])))]),
    );
    const days = Object.fromEntries(
      daily
        .slice(1)
        .map((r) => [compact(text(requiredValue(r[0]))), compact(text(requiredValue(r[1])))]),
    );
    const initial = contents(body(first));
    const pageMatch = /(\d+) provider offers · page 1 of (\d+)/.exec(initial);
    need(pageMatch, "Missing directory offer/page count");
    const expectedOffers = Number(pageMatch[1]),
      pages = Number(pageMatch[2]);
    need(pages > 0 && pages < 100, "Invalid directory page count");
    const countMatch = /(\d+) Models (\d+) Providers/.exec(initial);
    need(countMatch, "Missing directory model count");
    const expectedModels = Number(countMatch[1]);
    const found = new Map<
      string,
      {
        premium: boolean;
        urls: string[];
        offers: number;
      }
    >();
    let offers = 0;
    for (let page = 1; page <= pages; page++) {
      const url = page === 1 ? first : `${first}?page=${page}`;
      const n = root(body(url));
      const txt = compact(text(n));
      need(
        txt.includes(`${expectedOffers} provider offers · page ${page} of ${pages}`),
        "Directory pages changed during capture",
      );
      const rows = findTable(n, [
        "Provider",
        "Model ID",
        "Input $/M",
        "Output $/M",
        "Cache Read $/M",
        "Features",
      ]);
      for (const row of rows.slice(1)) {
        const cell = requiredValue(row[1]);
        const anchors = nodes(cell, ["a"]).filter((a) =>
          (attr(a, "href") ?? "").startsWith("https://llmgateway.io/models/"),
        );
        need(anchors.length === 1, "Missing exact model link");
        const id = compact(text(requiredValue(anchors[0])));
        need(
          /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(id),
          `Expected unprefixed request model ID: ${id}`,
        );
        const premium = nodes(cell, ["svg"]).some((s) =>
          (attr(s, "class") ?? "").split(/\s+/).includes("lucide-gem"),
        );
        const prev = found.get(id);
        if (prev) {
          need(prev.premium === premium, "Inconsistent premium classification");
          prev.offers++;
          if (!prev.urls.includes(url)) prev.urls.push(url);
        } else found.set(id, { premium, urls: [url], offers: 1 });
        offers++;
      }
    }
    need(offers === expectedOffers, "Incomplete provider-offer enumeration");
    need(found.size === expectedModels, "Incomplete distinct model enumeration");
    return listRows(
      [...found].map(([id, m]) => ({
        id,
        plans,
        status: "available",
        conditions: {
          premium: m.premium,
          premium_weekly_caps: m.premium ? caps : {},
          daily_pacing_caps: days,
          premium_window: "fixed seven days from first premium request",
          daily_window: "rolling 24 hours from first request",
          provider_pinning_allowed: false,
          provider_prefixed_ids_allowed: false,
          payg_overflow_is_separate: true,
          catalog_scope:
            "complete published coding directory; not a guarantee of every non-coding gateway model",
          provider_offers: m.offers,
        },
        evidence: [
          ...m.urls.map((url) =>
            evidence(url, `Directory table > Model ID ${id}${m.premium ? " > premium gem" : ""}`),
          ),
          evidence(plansUrl, "Lite, Pro and Max > every plan includes"),
          evidence(rules, "DevPass premium / daily cap tables and provider routing restrictions"),
        ],
      })),
    );
  }
  if (subscriptionId === "commandcode-plans") {
    const u = "https://api.commandcode.ai/provider/v1/models",
      base = "https://commandcode.ai/docs/plans/",
      limits = "https://commandcode.ai/docs/resources/pricing-limits",
      provider = "https://commandcode.ai/docs/provider";
    const apiList = array(object(JSON.parse(body(u))).data).map(object);
    const byName = new Map<string, Obj>();
    for (const m of apiList) {
      const name = string(m.name);
      need(!byName.has(name), "Duplicate provider display name");
      byName.set(name, m);
    }
    const maxUrl = `${base}max`,
      mt = contents(body(maxUrl));
    need(
      mt.includes("Both include every model") && mt.includes("no restrictions"),
      "Missing full Max scope",
    );
    const maxTable = findTable(root(body(maxUrl)), [
      "Plan",
      "Price/mo",
      "Credits/mo",
      "Included LLM Usage",
      "Models",
    ]);
    const maxPlans = maxTable.slice(1).map((r) => compact(text(requiredValue(r[0]))));
    const ld = root(body(limits)),
      lt = compact(text(ld));
    need(lt.includes("CMD_ZDR=1"), "Missing ZDR rule");
    const regions = findTable(ld, ["Model", "Provider", "Unavailable in"]);
    const regionByName = new Map(
      regions
        .slice(1)
        .map((r) => [compact(text(requiredValue(r[0]))), compact(text(requiredValue(r[2])))]),
    );
    const ptxt = contents(body(provider));
    need(
      ptxt.includes("Every plan except Go") || ptxt.includes("Every plan except the Go plan"),
      "Missing Go API restriction",
    );
    const endpointTable = findTable(root(body(provider)), ["Endpoint", "Method", "Format"]);
    const endpointURLs = new Set(
      endpointTable.slice(1).map((r) => compact(text(requiredValue(r[0]))).replace(/\s*Copy$/, "")),
    );
    const map = new Map(
      apiList.map((m) => {
        const id = string(m.id);
        const endpoints = array(m.supported_endpoints).map(string);
        const api: Record<string, string> = {};
        for (const end of endpoints) {
          need(end.startsWith("/"), "Invalid native endpoint suffix");
          const full = `https://api.commandcode.ai/provider/v1${end}`;
          need(endpointURLs.has(full), `Undocumented native endpoint ${full}`);
          const protocol =
            end === "/messages"
              ? "anthropic-messages"
              : end === "/responses"
                ? "openai-responses"
                : end === "/chat/completions"
                  ? "openai-chat-completions"
                  : `commandcode-${end.slice(1)}`;
          api[protocol] = full;
        }
        return [
          id,
          {
            id,
            plans: [...maxPlans],
            status: "available",
            api,
            conditions: {
              native_name: string(m.name),
              cli_only_plans: [],
              api_plans: [...maxPlans],
              unavailable_regions: regionByName.get(string(m.name)) ?? null,
              per_model_plan_credits: {},
              plan_usage_windows_apply: true,
              zdr_route_eligibility_must_be_checked: true,
              catalog_count_discrepancy: true,
              unresolved_plan_display_names: [],
            },
            evidence: [
              evidence(u, `$.data[id=${id}]`),
              evidence(maxUrl, "Both Max tiers include every model"),
              evidence(provider, "Native supported endpoints / Go API exclusion"),
            ],
          } as Row,
        ] as const;
      }),
    );
    const maxCreditTable = findTable(root(body(maxUrl)), [
      "Model",
      "Input",
      "Output",
      "Cache Read",
      "Cache Write",
      ...maxPlans.map((p) => `${p} credits`),
    ]);
    for (const r of maxCreditTable.slice(1)) {
      const display = compact(text(requiredValue(r[0])));
      const m = byName.get(display);
      if (!m) continue;
      const c = requiredValue(requiredValue(map.get(string(m.id))).conditions);
      const credits = object(c.per_model_plan_credits);
      for (let i = 0; i < maxPlans.length; i++)
        credits[requiredValue(maxPlans[i])] = compact(text(requiredValue(r[5 + i])));
    }
    const windows = findTable(ld, [
      "Plan",
      "Your cost",
      "Monthly credits",
      "5-hour limit",
      "Weekly limit",
    ]);
    const windowMap = Object.fromEntries(
      windows.slice(1).map((r) => [
        compact(text(requiredValue(r[0]))),
        {
          monthly_credits: compact(text(requiredValue(r[2]))),
          five_hour_limit: compact(text(requiredValue(r[3]))),
          weekly_limit: compact(text(requiredValue(r[4]))),
        },
      ]),
    );
    for (const row of map.values()) requiredValue(row.conditions).plan_usage_windows = windowMap;
    const unresolved = new Set<string>();
    for (const slug of ["go", "goat", "pro"]) {
      const url = base + slug,
        n = root(body(url)),
        pt = compact(text(n));
      const name = slug === "go" ? "Go" : slug === "goat" ? "GOAT" : "Pro";
      const included = findTable(n, [
        "Model",
        "Context",
        "Input",
        "Output",
        "Cache read",
        "Cache write",
        "Caps",
      ]);
      const pattern = new RegExp(`${name === "GOAT" ? "GOAT" : name} plan (\\d+)\\s*All plans`);
      const count = pattern.exec(pt);
      need(count && Number(count[1]) === included.length - 1, `Incomplete ${name} table`);
      for (const cells of included.slice(1)) {
        const display = nameCell(requiredValue(cells[0]));
        const native = byName.get(display);
        if (!native) {
          unresolved.add(display);
          continue;
        }
        const row = requiredValue(map.get(string(native.id)));
        row.plans.push(name);
        const c = requiredValue(row.conditions);
        const cli = array(c.cli_only_plans),
          api = array(c.api_plans);
        if (name === "Go") cli.push(name);
        else api.push(name);
        c.cli_only_plans = cli as JsonValue;
        c.api_plans = api as JsonValue;
        c.free_model = compact(text(requiredValue(cells[2]))) === "Free";
        c.caps_text = compact(text(requiredValue(cells[6])));
        c.model_label_annotations = compact(text(requiredValue(cells[0])))
          .replace(display, "")
          .trim();
        row.evidence.push(evidence(url, `Models included > Model = ${display}`));
      }
      const creditTables = nodes(n, ["table"])
        .map(tableRows)
        .filter(
          (rs) =>
            headerText(requiredValue(rs[0]?.[0])) === "Model" &&
            headerText(requiredValue(rs[0]?.at(-1))) === "Monthly credits",
        );
      for (const table of creditTables)
        for (const r of table.slice(1)) {
          const display = compact(text(requiredValue(r[0])));
          const m = byName.get(display);
          if (!m) continue;
          const c = requiredValue(requiredValue(map.get(string(m.id))).conditions);
          const credits = object(c.per_model_plan_credits);
          credits[name] = compact(text(requiredValue(r.at(-1))));
        }
    }
    for (const row of map.values()) {
      const c = requiredValue(row.conditions);
      c.unresolved_plan_display_names = [...unresolved];
      c.zdr_free_models_excluded = !!c.free_model;
      if (c.free_model) {
        const display = string(c.native_name);
        const articles = nodes(ld, ["article"]).filter(
          (article) =>
            !!attr(article, "id") &&
            nodes(article, ["dt"]).some((term) => {
              if (compact(text(term)) !== "Model") return false;
              const siblings = term.parentNode?.childNodes ?? [];
              const next = siblings
                .slice(siblings.indexOf(term) + 1)
                .find((n) => n.tagName === "dd");
              return !!next && compact(text(next)) === display;
            }),
        );
        const article = articles.length === 1 ? articles[0] : undefined;
        const source = article ? compact(text(article)) : "";
        const nativeCode = row.id.split("/").at(-1);
        const modelCodeMatches =
          !!article && nodes(article, ["code"]).some((n) => compact(text(n)) === nativeCode);
        const limit = /([\d,]+) requests a day, per account/.exec(source);
        const balance = /Need to have \$(\d+(?:\.\d+)?) of credits in your account/.exec(source);
        const dataUse = source.includes(
          "the provider may keep your prompts and outputs and train on them",
        );
        const noZdr = source.includes(`${display} won't run in a CMD_ZDR=1 session.`);
        if (
          !article ||
          !modelCodeMatches ||
          !limit ||
          !balance ||
          !source.includes("midnight UTC") ||
          !source.includes("Available to all customers") ||
          !dataUse ||
          !noZdr
        ) {
          c.candidate_plan_membership = row.plans;
          c.free_model_policy_verified = false;
          c.free_model_policy_issue =
            "The exact model deal article must establish request ID, daily quota, minimum balance, reset, data use, and ZDR exclusion.";
          row.status = "unknown";
          row.plans = [];
          c.api_plans = [];
          c.cli_only_plans = [];
        } else {
          c.free_model_policy_verified = true;
          c.free_model_policy = {
            requests_per_day: Number(requiredValue(limit[1]).replace(/,/g, "")),
            reset: "midnight UTC",
            minimum_account_credits_usd: Number(balance[1]),
            may_train_on_prompts_and_outputs: true,
            zdr_supported: false,
          };
          row.evidence.push(
            evidence(
              limits,
              `article#${attr(article, "id")} > Model ${display}; exact request code; daily quota / minimum balance / provider data use / ZDR exclusion`,
            ),
          );
        }
      }
    }
    return listRows([...map.values()]);
  }
  if (subscriptionId === "oathbreaker") {
    const u = "https://oathbreaker.ai/docs",
      p = "https://oathbreaker.ai/pricing";
    const d = root(body(u)),
      n = root(body(p)),
      pt = compact(text(n));
    need(
      contents(body(u)).includes("The models share the same API key and credit balance"),
      "Missing shared model wallet rule",
    );
    const planTable = findTable(n, [
      "Plan",
      "Price",
      "Credit each month",
      "Worth at standard rates",
    ]);
    const plans = planTable
      .slice(1)
      .map((r) => compact(text(requiredValue(r[0]))).replace(/\s*· recommended$/, ""));
    need(
      pt.includes("on every model except") && pt.includes("Your credit never expires"),
      "Missing membership scope and expiry qualifiers",
    );
    const t = findTable(d, ["Model", "Input", "Cached input", "Output"]);
    const rows: Row[] = [];
    for (const r of t.slice(1)) {
      const id = compact(text(requiredValue(r[0])));
      need(/^oathbreaker-[a-z0-9.-]+$/.test(id), "Invalid native ID");
      const pricingNodes = nodes(n, ["section"]).filter((s) =>
        nodes(s, ["code"]).some((c) => compact(text(c)) === id),
      );
      let matching = pricingNodes.sort(
        (a, b) => compact(text(a)).length - compact(text(b)).length,
      )[0];
      if (!matching) {
        const codeNodes = nodes(n, ["code"]).filter((c) => compact(text(c)) === id);
        need(codeNodes.length > 0, `Missing pricing ID ${id}`);
        let cur = requiredValue(codeNodes[0]);
        while (cur.parentNode && !nodes(cur, ["table"]).length) cur = cur.parentNode;
        matching = cur;
      }
      const tables = nodes(matching, ["table"]).map(tableRows);
      const rates = tables.find((rs) => headerText(requiredValue(rs[0]?.[0])) === "Token type");
      need(rates, "Missing rate table");
      const headers = requiredValue(rates[0]).map(headerText);
      need(
        headers.join("|") === "Token type|Standard|Member" ||
          headers.join("|") === "Token type|Price",
        "Unknown membership pricing",
      );
      const member = headers.includes("Member");
      rows.push({
        id,
        plans,
        status: "available",
        conditions: {
          member_rate_discount_applies: member,
          member_discount_excluded: !member,
          credits_do_not_expire: true,
          standard_rates_after_subscription_ends: true,
          rate_table: rates.slice(1).map((r) => r.map((c) => compact(text(c)))),
        },
        api: {
          "openai-chat-completions": "https://oathbreaker.ai/v1/chat/completions",
          "openai-responses": "https://oathbreaker.ai/v1/responses",
          "anthropic-messages": "https://oathbreaker.ai/v1/messages",
        },
        evidence: [
          evidence(u, `Available models > Model ${id}; shared API key and credit balance`),
          evidence(p, `Membership plan table / native model ${id} rate table`),
        ],
      });
    }
    return listRows(rows);
  }
  if (subscriptionId === "subconscious") {
    const p = "https://www.subconscious.dev/pricing",
      n = root(body(p));
    const pt = compact(text(n));
    need(
      pt.includes("Every model, shared across your team") &&
        pt.includes("On Dedicated Deployments:"),
      "Missing token-plan scope/exclusions",
    );
    const offers = jsonLd(n).filter((x) => x["@type"] === "Offer");
    const plans = offers
      .filter((x) => x.category === "Subscription")
      .map((x) => {
        const m = /^Team Token Plan: (.+)$/.exec(string(x.name));
        need(m, "Unknown subscription Offer");
        return requiredValue(m[1]);
      });
    need(plans.length > 0, "Missing subscription Offer plans");
    const rows: Row[] = [];
    for (const offer of offers.filter((x) => x.category === "Usage based")) {
      const name = string(offer.name);
      const m = /^(.+) pay per token \(([^()]+)\)$/.exec(name);
      need(m, "Missing explicit model name/native ID pair");
      need(requiredValue(m[2]).startsWith("subconscious/"), "Unexpected native ID namespace");
      need(pt.includes(requiredValue(m[1])), `Native model absent from visible API table ${m[1]}`);
      rows.push({
        id: requiredValue(m[2]),
        plans,
        status: "available",
        conditions: {
          display_name: requiredValue(m[1]),
          daily_shared_allowance: true,
          reset_timezone: "UTC",
          overage: "per-token billing after daily allowance",
          daily_allowance_resets_at: "00:00",
          dedicated_deployment_models_excluded: true,
          custom_terms_plan_not_automatically_granted: true,
        },
        evidence: [
          evidence(
            p,
            `JSON-LD Offer.name = ${name}; Team Token Plan subscription Offers; Every model shared scope`,
          ),
        ],
      });
    }
    return listRows(rows);
  }
  if (subscriptionId === "qiniu-ai-subscription") {
    const u = "https://developer.qiniu.com/aitokenapi/13330/subscription-introduction",
      t = contents(body(u));
    need(
      t.includes("每个订阅等级包含一组精选 AI 模型") &&
        t.includes("订阅必须通过订阅专用 API Key 访问"),
      "Missing tier-specific eligibility and key restrictions",
    );
    const start = t.indexOf("当前覆盖模型范围：");
    need(start >= 0, "Missing covered-model anchor");
    const end = t.indexOf("后续将持续更新", start);
    need(end > start, "Missing covered-model sentinel");
    const segment = t.slice(start + "当前覆盖模型范围：".length, end).trim();
    const ids = segment.split(/\s+/);
    need(
      ids.every((id) => /^[a-z0-9-]+\/[A-Za-z0-9.-]+$/.test(id)),
      "Invalid covered model IDs",
    );
    return listRows(
      ids.map((id) => ({
        id,
        plans: [],
        status: "unknown",
        conditions: {
          subscription_level_coverage_documented: true,
          per_tier_membership_unknown: true,
          subscription_only_api_key_required: true,
          weekly_allowance_windows: true,
          out_of_tier_or_excess_usage_rejected: true,
          payg_key_is_separate: true,
        },
        evidence: [
          evidence(u, `Current covered-model scope list > ${id}; unnamed tier model sets`),
        ],
      })),
    );
  }
  if (subscriptionId === "meta")
    throw new Error(
      "Muse Code subscription sources name model families but publish no native CLI request identifiers. Separate PAYG Model API IDs cannot be substituted.",
    );
  throw new Error(`Unsupported public source ${subscriptionId}`);
}
export function extract(subscriptionId: string, bodies: Record<string, string>): Row[] {
  const rows = extractUnscoped(subscriptionId, bodies);
  for (const row of rows) {
    const c = row.conditions ?? {};
    let routes: string[] = [];
    if (row.status === "available") {
      if (subscriptionId === "inferall-subscription") routes = ["direct-model-subscription"];
      if (subscriptionId === "llmgateway-devpass") routes = ["devpass-api-key", "devpass-code-cli"];
      if (subscriptionId === "commandcode-plans") {
        routes = ["commandcode-cli", "commandcode-provider-api-plan"];
        c.route_plan_access = {
          "commandcode-cli": row.plans,
          "commandcode-provider-api-plan": c.api_plans ?? [],
        };
      }
      if (subscriptionId === "oathbreaker" || subscriptionId === "subconscious") routes = ["api"];
    }
    row.conditions = { ...c, route_ids: routes, request_protocol_qualified: routes.length > 0 };
  }
  return rows;
}
