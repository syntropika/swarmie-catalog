import { expect, test } from "bun:test";
import { openCodeGo, vercelTokenPass } from "../src/adapters/catalogs/aggregators.ts";
import { extract as credits } from "../src/adapters/catalogs/credit-plans.ts";
import { extract as regional } from "../src/adapters/catalogs/regional-extras.ts";
import { extract as tables } from "../src/adapters/catalogs/table-catalogs.ts";
import type { DiscoveredModel } from "../src/adapters/catalogs/types.ts";
import { publicCatalogAdapter } from "../src/adapters/public.ts";
import { composeSubscription } from "../src/compose.ts";
import { composeConnections } from "../src/connections.ts";
import { emptyRegistry, synchronize } from "../src/engine.ts";
import type { SourceLoader } from "../src/fetch.ts";
import { composeModelResearch, modelResearch } from "../src/model-research.ts";
import { modelSources, modelSourcesSchema } from "../src/model-sources.ts";
import { hash } from "../src/stable.ts";
import { now, upstream } from "./helpers.ts";

const goUrl = "https://opencode.ai/inference/go/v1/models";
const goScope = "https://opencode.ai/docs/console/api/models/";
const goPlans = "https://opencode.ai/docs/console/go/";
const vercelUrl = "https://vercel.com/docs/ai-gateway/token-pass";
const tokenScope =
  "<p>Token Pass credit covers these models. Featured models served by the Token Pass provider. Pro teams.</p>".replace(
    "Featured",
    "featured",
  );
const modelTable =
  "<table><tr><th>Model</th><th>Model ID</th></tr><tr><td>Included</td><td><code>maker/included</code></td></tr></table>";
test("OpenCode plan allowances, free pricing and privacy remain model-specific", () => {
  const flags = { training: true, zdr: false, limited_regions: true };
  const models = [
    { id: "maker/native", go: { ...flags, monthly_usage: { go: 10, "go-plus": 0 } } },
    {
      id: "free-native",
      cost: { text: { input: { price: 0 }, output: { price: 0 } } },
      go: { ...flags, monthly_usage: null },
    },
    {
      id: "unknown-native",
      cost: { text: { input: { price: 1 }, output: { price: 1 } } },
      go: { ...flags, monthly_usage: null },
    },
  ];
  const bodies = {
    [goUrl]: JSON.stringify({ object: "list", data: models }),
    [goScope]: "<p>Each Go model also has its plan fields.</p>",
    [goPlans]: "<p>continue using the free models</p>",
  };
  const rows = openCodeGo(bodies, []);
  expect(rows.find((r) => r.id === "maker/native" && r.plans.includes("go"))?.status).toBe(
    "available",
  );
  expect(rows.find((r) => r.id === "maker/native" && r.plans.includes("go-plus"))?.status).toBe(
    "unavailable",
  );
  expect(
    rows
      .filter((r) => r.id === "free-native")
      .every((r) => r.status === "available" && r.conditions?.free === true),
  ).toBe(true);
  expect(rows.filter((r) => r.id === "unknown-native").every((r) => r.status === "unknown")).toBe(
    true,
  );
  expect(
    rows.every((r) => r.conditions?.limited_regions === true && r.conditions?.training === true),
  ).toBe(true);
  expect(() => openCodeGo({ ...bodies, [goScope]: "different policy" }, [])).toThrow("contract");
});
test("Token Pass reads only the scoped table and rejects lost or ambiguous membership", () => {
  const rows = vercelTokenPass({ [vercelUrl]: tokenScope + modelTable }, []);
  expect(rows.map((r) => r.id)).toEqual(["maker/included"]);
  expect(rows[0]?.conditions?.serving_provider).toBe("token-pass");
  expect(() => vercelTokenPass({ [vercelUrl]: modelTable }, [])).toThrow("scope changed");
  expect(() =>
    vercelTokenPass({ [vercelUrl]: tokenScope + modelTable + modelTable }, []),
  ).toThrow();
  expect(() =>
    vercelTokenPass(
      {
        [vercelUrl]: tokenScope + modelTable.replace("<code>maker/included</code>", "display name"),
      },
      [],
    ),
  ).toThrow("request model ID");
});

test("native models survive unresolved canonical links and plans keep their own route scopes", async () => {
  const definition = modelSources.products.find((p) => p.product === "vercel-token-pass");
  if (!definition) throw new Error("Missing source definition");
  const direct = "token-pass-gateway-api",
    agent = "token-pass-fx-login";
  const row: DiscoveredModel = {
    id: "maker/native-future",
    plans: ["starter", "pro"],
    status: "available",
    conditions: {
      route_ids: [direct, agent],
      route_plan_access: { [direct]: ["pro"], [agent]: ["starter", "pro"] },
    },
    evidence: [{ url: vercelUrl, locator: "Synthetic membership fixture" }],
  };
  const loader: SourceLoader = async (request) => {
    if (request.kind !== "http") throw new Error("Unexpected source");
    return {
      source: {
        id: request.id,
        url: request.url,
        revision: null,
        modified_at: null,
        sha256: hash("fixture"),
      },
      body: "fixture",
    };
  };
  const u = await upstream();
  const adapter = publicCatalogAdapter(definition, () => [row]);
  const result = await synchronize({
    previous: emptyRegistry(),
    upstream: u,
    adapters: [adapter],
    loader,
    aliases: {},
    now,
  });
  expect(result.failures).toEqual([]);
  const claims = result.registry.providers[0]?.claims ?? [];
  expect(
    claims.every((c) => c.model_id === null && c.request_model_id === "maker/native-future"),
  ).toBe(true);
  expect(claims.find((c) => c.plan === "starter")?.route_ids).toEqual([agent]);
  expect(claims.find((c) => c.plan === "pro")?.route_ids).toEqual([direct, agent]);
  const view = composeSubscription(u, result.registry, "vercel-token-pass", "a".repeat(64));
  expect(Object.keys(view.models)).toHaveLength(1);
  expect(Object.values(view.models)[0]?.subscription_access).toHaveLength(2);
  expect(
    composeConnections(u, "a".repeat(64), result.registry).routes.find(
      (r) => r.subscription_id === "vercel-token-pass" && r.id === direct,
    )?.model_catalog.status,
  ).toBe("ready");
  row.plans = [];
  row.status = "unknown";
  row.conditions = { route_ids: [] };
  const unknown = await synchronize({
    previous: emptyRegistry(),
    upstream: u,
    adapters: [adapter],
    loader,
    aliases: {},
    now,
  });
  expect(unknown.registry.providers[0]?.claims[0]?.plan).toBeNull();
  expect(
    Object.keys(
      composeSubscription(u, unknown.registry, "vercel-token-pass", "a".repeat(64)).models,
    ),
  ).toHaveLength(1);
  expect(
    composeConnections(u, "a".repeat(64), unknown.registry).routes.find(
      (r) => r.subscription_id === "vercel-token-pass" && r.id === direct,
    )?.model_catalog.status,
  ).toBe("unavailable");
  row.status = "available";
  expect(() =>
    adapter.parse([
      {
        source: {
          id: "models",
          url: vercelUrl,
          revision: null,
          modified_at: null,
          sha256: hash("fixture"),
        },
        body: "fixture",
      },
    ]),
  ).toThrow("named subscription plan");
});

test("subscription source cross-checks retain ambiguity and reject an unhealthy upstream", () => {
  const bodies = {
    "https://api.nano-gpt.com/api/subscription/v1/models?detailed=true": JSON.stringify({
      object: "list",
      data: [{ id: "included-model" }, { id: "ambiguous-router" }],
    }),
    "https://api.nano-gpt.com/api/paid/v1/models?detailed=true": JSON.stringify({
      object: "list",
      data: [{ id: "ambiguous-router" }],
    }),
    "https://docs.nano-gpt.com/api-reference/endpoint/models":
      "<p>Always returns only models included in the NanoGPT subscription /api/subscription/v1/models</p>",
    "https://nano-gpt.com/pricing":
      "<p>On the web and through the API. Paid models keep billing your balance.</p><h2>PRO</h2>",
  };
  const rows = regional("nano-gpt-pro", bodies);
  expect(rows.find((r) => r.id === "included-model")?.status).toBe("available");
  expect(rows.find((r) => r.id === "ambiguous-router")?.status).toBe("unknown");
  expect(() =>
    regional("anonrouter", {
      "https://control.anonrouter.ai/v1/catalog/models": JSON.stringify({
        object: "catalog",
        schema_version: 1,
        stale: true,
        status: "critical",
      }),
      "https://control.anonrouter.ai/v1/billing/catalog": "{}",
      "https://docs.anonrouter.ai/subscriptions":
        "<p>Every plan can use every model, endpoint and the API</p>",
    }),
  ).toThrow("not healthy");
});

test("Sarvam native ID annotations cannot turn request parameter names into models", () => {
  const modelUrl = "https://docs.sarvam.ai/api/token-factory/models.md";
  const ownUrl = "https://docs.sarvam.ai/api/getting-started/models.md";
  const bulbul = "https://docs.sarvam.ai/api/api-guides-tutorials/models/bulbul.md";
  const rows = credits("sarvam-credit-plans", {
    [modelUrl]:
      "# Models\n**Serverless**: Listed below.\n**Provisioned Throughput**: Separate.\n## All models as a table\n| Model | Context |\n| --- | --- |\n| `chat-native` | 1000 |",
    [ownUrl]: "[Speech](/api/api-guides-tutorials/models/bulbul)",
    [bulbul]: "# Speech\n| **Model ID** | `bulbul:v3` (stable; default when `model` is omitted) |",
    "https://www.sarvam.ai/api-pricing":
      "<p>Pro, Growth and Business have a minimum monthly subscription that comes back in full as credits. credits are universal and can be used across all supported APIs and services</p>",
  });
  expect(rows.map((r) => r.id)).toEqual(["chat-native", "bulbul:v3"]);
  expect(rows.some((r) => r.id === "model")).toBe(false);
});

test("Neuralwatt exclusions use exact source IDs and nonchat models receive no chat route", () => {
  const url = "https://api.neuralwatt.com/v1/models",
    pricing = "https://portal.neuralwatt.com/pricing";
  const rows = tables(
    "neuralwatt",
    {
      [url]: JSON.stringify({
        object: "list",
        scope: "public",
        data: ["included-fast", "excluded-native", "decision-native"].map((id) => ({
          id,
          metadata: { deprecated: false, pricing: { service_tier: "standard" } },
          architecture: { output_modalities: id === "decision-native" ? ["decisions"] : ["text"] },
        })),
      }),
      [pricing]:
        '<table><tr><th data-matrix-col="plus"><span class="text-lg">Plus</span><span aria-label="allowance outside speed lanes"></span></th></tr><tr><td data-matrix-cell="includes:payg">All models.</td><td data-matrix-cell="includes:plus">Everything in pay as you go</td></tr></table><div data-speed-lanes-block><div data-speed-lane-row="excluded-native"><code>excluded-native</code></div></div>',
    },
    ["api"],
  );
  expect(rows.find((r) => r.id === "included-fast")?.status).toBe("available");
  expect(rows.find((r) => r.id === "excluded-native")?.status).toBe("unavailable");
  expect(rows.find((r) => r.id === "decision-native")?.conditions?.route_ids).toEqual([]);
});

test("source definitions validate ownership and newly added providers remain unreviewed", async () => {
  const broken = structuredClone(modelSources);
  const first = broken.products[0];
  if (!first) throw new Error("Missing sources");
  first.routes = ["unowned-route"];
  expect(modelSourcesSchema.safeParse(broken).success).toBe(false);
  const u = await upstream();
  u.providers["new-provider"] = { id: "new-provider", models: {} };
  const review = composeModelResearch(u).providers.find((p) => p.provider_id === "new-provider");
  expect(review?.subscription_status).toBe("unknown");
  expect(review?.profiles).toEqual([]);
  expect(new Set(modelResearch.providers.map((p) => p.provider_id)).size).toBe(
    modelResearch.providers.length,
  );
});
