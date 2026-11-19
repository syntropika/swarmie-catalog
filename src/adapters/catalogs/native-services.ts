import { parse } from "parse5";
import type { Extracted } from "./credit-plans.ts";
import { requiredValue } from "./validation.ts";

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
function text(node: Html): string {
  if (node.tagName === "script" || node.tagName === "style") return "";
  return ((node.value ?? "") + (node.childNodes ?? []).map(text).join(" "))
    .replace(/\s+/g, " ")
    .trim();
}
function body(bodies: Record<string, string>, url: string): string {
  const result = bodies[url];
  if (!result) throw new Error(`Missing body ${url}`);
  return result;
}
function requireText(haystack: string, needle: string): void {
  if (!haystack.includes(needle)) throw new Error(`Changed source scope: ${needle}`);
}
function tableRows(table: Html): string[][] {
  return tags(table, "tr").map((row) =>
    all(row, (node) => node.tagName === "th" || node.tagName === "td").map(text),
  );
}
function tableWithHeaders(doc: Html, headers: string[]): string[][] {
  const tables = tags(doc, "table")
    .map(tableRows)
    .filter((rows) => JSON.stringify(rows[0]) === JSON.stringify(headers));
  if (tables.length !== 1) throw new Error(`Missing/ambiguous table ${headers.join(",")}`);
  return requiredValue(tables[0]).slice(1);
}
function markdownRows(markdown: string, heading: string): string[][] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => /^#{1,6} /.test(line) && line.replace(/^#{1,6} /, "") === heading,
  );
  if (start < 0) throw new Error(`Missing heading ${heading}`);
  const section = lines.slice(start + 1);
  const end = section.findIndex((line) => /^#{1,6} /.test(line));
  const relevant = end < 0 ? section : section.slice(0, end);
  const tableStart = relevant.findIndex((line) => line.startsWith("|"));
  if (tableStart < 0) throw new Error(`Missing table ${heading}`);
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
  if (rows.length < 3) throw new Error("Empty table");
  return rows.slice(2);
}
function words(value: string): string[] {
  return value
    .split(/,\s*(?:and\s+)?|\s+and\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function sakana(bodies: Record<string, string>): Extracted[] {
  const modelUrl = "https://console.sakana.ai/models",
    planUrl = "https://console.sakana.ai/pricing";
  const models = root(body(bodies, modelUrl)),
    pricing = root(body(bodies, planUrl));
  const scope = text(pricing).match(/Every tier includes ([^.]+)\./)?.[1];
  if (!scope) throw new Error("Missing explicit included families");
  const families = words(scope).sort((a, b) => b.length - a.length);
  const plans = tableWithHeaders(pricing, ["Plan", "Price", "Best for", "Usage"]).map((row) =>
    requiredValue(row[0]),
  );
  const rows = tableWithHeaders(models, ["Model ID", "Description"]);
  const output: Extracted[] = [];
  for (const [id, description] of rows) {
    if (!id || !description) throw new Error("Malformed model row");
    const family = families.find((name) =>
      new RegExp(`(?:^|\\s)${escapePattern(name)}(?=\\s+(?:model|alias)|[.,]|$)`).test(description),
    );
    if (!family) continue;
    output.push({
      id,
      plans,
      status: "available",
      conditions: {
        route_ids: ["direct-model-subscription"],
        included_family: family,
        alias_description: description,
      },
      evidence: [
        { url: modelUrl, locator: `Supported models table; Model ID=${id}` },
        { url: planUrl, locator: "Subscription Plan table; Every tier includes sentence" },
      ],
    });
  }
  if (!output.length) throw new Error("No included model families");
  return output;
}
export function zeldoc(bodies: Record<string, string>): Extracted[] {
  const pricingUrl = "https://zeldoc.ai/en/pricing",
    docUrl = "https://docs.zeldoc.ai/what-is-zeldoc/";
  const pricing = root(body(bodies, pricingUrl)),
    doc = root(body(bodies, docUrl));
  const sections = new Map(
    tags(pricing, "section")
      .filter((node) => attr(node, "id"))
      .map((node) => [requiredValue(attr(node, "id")), node]),
  );
  function plans(sectionId: string): string[] {
    const node = sections.get(sectionId);
    if (!node) throw new Error(`Missing section ${sectionId}`);
    return tags(node, "h3")
      .filter((node) => (attr(node, "class") ?? "").split(" ").includes("site-plan-name"))
      .map(text);
  }
  const corePlans = plans("zcore-pricing"),
    devPlans = plans("zdev-pricing");
  if (!corePlans.length || !devPlans.length) throw new Error("Missing plan cards");
  const ptext = text(pricing);
  const coreIds = ptext
    .match(/Only (\S+) and (\S+) count against the pool and the limit/)
    ?.slice(1);
  if (!coreIds?.length) throw new Error("Missing exact core IDs");
  const devId = text(doc).match(/update it to (\S+) to continue using the latest version/)?.[1];
  if (!devId) throw new Error("Missing exact current coding model ID");
  return [
    ...coreIds.map((id) => ({
      id,
      plans: corePlans,
      status: "available" as const,
      conditions: {
        route_ids: ["zcore-api"],
        bulk_scripts_and_resale_excluded: true,
        external_user_apps_require_separate_agreement: true,
      },
      evidence: [
        {
          url: pricingUrl,
          locator: "ZCore Throughput exact model IDs; #zcore-pricing plan headings",
        },
      ],
    })),
    {
      id: devId,
      plans: devPlans,
      status: "available",
      conditions: {
        route_ids: ["zdev-api"],
        business_organization_only: true,
        coding_use_only: true,
        go_sold_out: requireSoldOut(pricing),
        bulk_scripts_and_resale_excluded: true,
      },
      evidence: [
        { url: docUrl, locator: "ZDev current model ID in previously named Z-Code paragraph" },
        { url: pricingUrl, locator: "#zdev-pricing plan headings and fair use" },
      ],
    },
  ];
}
function requireSoldOut(pricing: Html): boolean {
  return text(pricing).includes("Sold out Go");
}
export function sarvam(bodies: Record<string, string>): Extracted[] {
  const modelUrl = "https://docs.sarvam.ai/api/token-factory/models.md",
    overviewUrl = "https://docs.sarvam.ai/api/getting-started/models.md",
    pricingUrl = "https://www.sarvam.ai/api-pricing";
  const md = body(bodies, modelUrl),
    overview = body(bodies, overviewUrl),
    pricing = text(root(body(bodies, pricingUrl)));
  requireText(
    pricing,
    "credits are universal and can be used across all supported APIs and services",
  );
  const monthly = pricing.match(
    /([A-Z][A-Za-z ,]+) have a minimum monthly subscription that comes back in full as credits/,
  )?.[1];
  if (!monthly) throw new Error("Missing recurring credit plan scope");
  const plans = words(monthly);
  const rows = markdownRows(md, "All models as a table");
  const output = new Map<string, Extracted>();
  function add(
    id: string,
    url: string,
    locator: string,
    endpointFamily: string,
    extra: Record<string, boolean | string> = {},
  ): void {
    const prior = output.get(id);
    if (prior) {
      prior.evidence.push({ url, locator });
      return;
    }
    output.set(id, {
      id,
      plans,
      status: "available",
      conditions: {
        route_ids: [
          endpointFamily === "chat"
            ? "token-factory-credit-api"
            : endpointFamily === "decisions"
              ? "token-factory-decisions"
              : "sarvam-native-api",
        ],
        endpoint_family: endpointFamily,
        access: "standard",
        ...extra,
      },
      evidence: [
        { url, locator },
        { url: pricingUrl, locator: "Recurring subscription FAQ; universal credits FAQ" },
      ],
    });
  }
  const standardPageUrls = new Set<string>();
  for (const row of rows) {
    const first = requiredValue(row[0]);
    if (first.includes("Provisioned Throughput")) continue;
    const native = first.match(/`([^`]+)`/)?.[1];
    if (!native) throw new Error("Missing exact model ID");
    add(native, modelUrl, `All models as a table; native ID=${native}`, "chat");
    const link = first.match(/\]\(([^)]+)\)/)?.[1];
    if (link)
      standardPageUrls.add(
        new URL(`${requiredValue(link.split("#")[0])}.md`, "https://docs.sarvam.ai").href,
      );
  }
  // All own-model pages are linked from the public model index. Their Model ID row
  // provides current IDs; migration examples elsewhere on a page do not qualify.
  for (const match of overview.matchAll(
    /\]\((\/api\/api-guides-tutorials\/models\/[^)#]+)(?:#[^)]*)?\)/g,
  ))
    standardPageUrls.add(new URL(`${requiredValue(match[1])}.md`, "https://docs.sarvam.ai").href);
  // Prism is explicitly called serverless in the same source but uses Decisions.
  const serverless = md.match(/\*\*Serverless\*\*:([\s\S]*?)\*\*Provisioned Throughput\*\*/)?.[1];
  if (!serverless) throw new Error("Missing serverless qualification");
  for (const link of serverless.matchAll(
    /\]\((\/api\/token-factory\/models\/[^)#]+)(?:#[^)]*)?\)/g,
  ))
    standardPageUrls.add(new URL(`${requiredValue(link[1])}.md`, "https://docs.sarvam.ai").href);
  for (const url of standardPageUrls) {
    const page = body(bodies, url);
    const line = page.split(/\r?\n/).find((line) => /^\|\s*\*\*Model ID\*\*\s*\|/.test(line));
    if (!line) throw new Error(`Missing Model ID table ${url}`);
    const ids = [...line.replace(/\([^)]*\)/g, "").matchAll(/`([^`]+)`/g)].map((match) =>
      requiredValue(match[1]),
    );
    if (!ids.length) throw new Error(`No native IDs ${url}`);
    const family = url.includes("/api-guides-tutorials/")
      ? "sarvam-model-api"
      : url.includes("prism")
        ? "decisions"
        : "chat";
    for (const id of ids)
      add(id, url, `Model ID table; native ID=${id}`, family, {
        legacy: line.includes("legacy") && line.includes(`\`${id}\` (legacy)`),
      });
  }
  return [...output.values()];
}
