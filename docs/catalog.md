# Data contract and consumption

The JSON contract is versioned by `schema_version`. Its complete validation schema is
[`catalog.schema.json`](../schemas/catalog.schema.json). The TypeScript owner is
`src/schema.ts`.

## Availability records

| Field | Contract |
| --- | --- |
| `product` | Subscription product namespace, such as `openai-codex` |
| `provider` | Service provider, such as `openai` or `github` |
| `source_model` | Exact source model label or identifier |
| `model_id` | Exact models.dev canonical ID, or `null` when unresolved |
| `channel` | `subscription` or `api` |
| `plan` | Product-specific source plan token, or `null` when unspecified |
| `surface` | Source client token, or `null` for product-level evidence |
| `variant` | Explicit alias variant, or `null` |
| `minimum_client_version` | Required client version from evidence, or `null` |
| `status` | `available`, `unavailable`, or `unknown` |
| `reason` | Stable explanation code for the status |
| `evidence` | Source references with source-specific row or object locators |

`available` means that the source explicitly declares support within the record scope.
`unavailable` means that the source explicitly excludes that scope.
`unknown` means that evidence does not establish either result.
An absent record has no implicit status. A null scope is unspecified, not a wildcard.
The same model can have records for both channels and several products.

These statuses describe source evidence. They do not verify a real account, administrator
policy, rollout, quota, or current server acceptance. A provider-level `stale` state
makes all its declarations historical. Do not use a retained positive record as current authority.

The record key consists of product, source model, channel, plan, surface, and variant.
All records link to immutable source URLs, revisions, digests, and locators.
A model identity can remain unresolved while its original source declaration is retained.
Default consumer queries exclude unresolved identities and stale providers.

## Identity resolution

Copilot display names use the exact punctuation normalization used by the official
models.dev Copilot adapter. The result must match an offering ID. That offering must
link to an existing canonical model. Codex slugs use the exact OpenAI offering link
or the exact `openai/<slug>` canonical ID. Conflicting links fail the update.
There is no edit-distance search, model-family expansion, or guessed version mapping.

`data/aliases.json` is an optional exact mapping keyed by `product:source_model`.
Each entry must contain `model_id`, `variant`, `reason`, and an official `source` URL.
A missing alias target fails the provider update. The initial alias map is empty.
Aliases establish identity only. They do not grant availability.

## Static output

`bun run build` creates these files:

| File | Content |
| --- | --- |
| `catalog.json` | Complete enrichment layer, including stale and unresolved records |
| `catalog.schema.json` | JSON schema |
| `index.json` | Product and plan file paths |
| `subscriptions.json` | Available subscription declarations with current, resolved identities |
| `products/<product>.json` | Product records and provider evidence |
| `plans/<product>/<plan>.json` | Product-scoped plan records and provider state |
| `coverage.json` | Supported plans, status counts, unresolved identities, and coverage gaps |
| `health.json` | Reviewed snapshot state, source dates, and content digest |

Use `index.json` to discover exact plan paths. Path segments are URL-encoded.
The raw tokens `pro_plus` and `edu_pro`, for example, belong to different product namespaces.
An API-support flag produces `unknown` account access unless it explicitly excludes API mode.
The engine never converts API catalog membership into a general access grant.

## TypeScript consumption

The TypeScript helpers run in a compatible Bun or Node toolchain. Frontends can read
the static JSON directly without the synchronization modules.

```ts
import { enrich, query, registrySchema, upstreamSchema } from "./src/index.ts";

const registry = registrySchema.parse(await Bun.file("data/catalog.json").json());
const plus = query(registry, {
  product: "openai-codex",
  plan: "plus",
  channel: "subscription",
  status: "available",
});
const channels = query(registry, { model: "openai/gpt-6-sol" });

const response = await fetch(registry.upstream);
if (!response.ok) throw new Error("Upstream is unavailable");
const upstream = upstreamSchema.parse(await response.json());
const enriched = enrich(upstream, registry);
console.log(plus, channels, enriched);
```

`enrich` nests original metadata under `metadata` and known declarations under `access`.
It does not rewrite upstream fields. The caller supplies the upstream snapshot.
An API offering in upstream does not generate an availability claim by itself.
