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

## Provider routes

The public API consists of static JSON files. It uses the provider IDs and offering IDs
from models.dev. A provider response preserves its original fields, including the
`models` map. Each model receives a `subscription_access` array. The provider receives
`subscription_catalog` metadata with source definitions and the upstream content digest.
It also receives `subscription_research`, with the reviewed provider billing and
integration evidence described in the [source guide](sources.md#integration-evidence).
The provider response uses `subscription_catalog.schema_version: 2`. The declaration
registry keeps its independent `schema_version: 1` contract.
The complete response schema is [`provider.schema.json`](../schemas/provider.schema.json).

Each subscription entry contains `plans` instead of the declaration field `plan`.
The vector contains source plan tokens. A `null` element means that the plan is unspecified.
It does not grant access to every plan. All other declaration fields remain in the entry.
The entry also contains `subscription`, which identifies the subscription namespace, plus
`state`, `error`, and `source_updated_at` from its source owner.

Plans share an entry only when every access condition is equal. These conditions include
product, service provider, source model, canonical identity, channel, client, variant,
minimum client version, status, reason, source state, error, and source date. Evidence is
the deduplicated union of the original source references for those plans. Source locators
retain the original plan rows or model objects. Entries, plans, and evidence have stable order.

An OpenAI model can have entries from OpenAI Codex and GitHub Copilot. Their plan tokens
remain in separate product namespaces. A model can also have separate entries for different
clients or statuses. These declarations do not change the original provider endpoint,
credentials, pricing, or account authority.

Use only entries with `state: "current"` and `status: "available"` to select declared
subscription support. `unknown`, `unavailable`, and stale entries remain available for
inspection. No matching entry means that support is unknown for the requested scope.
It does not establish a global exclusion.

The composer uses explicit canonical links or an exact canonical provider/model ID.
An empty array means that no subscription evidence is attached. This can result from
missing source coverage or a missing or broken canonical identity. The original metadata
remains intact. No guessed identity or subscription claim is attached. Inspect `catalog.json`
and `coverage.json` for unresolved source identities and coverage gaps.

## Subscription routes

Use `subscriptions/<subscription>.json` to inspect one subscription across model vendors.
The response contains `id`, `name`, `products`, `integration`, `model_catalog`, `models`,
and `subscription_catalog`.
Its schema is [`subscription.schema.json`](../schemas/subscription.schema.json).

Use `index.json` or `subscriptions.json` for the complete service list. ChatGPT has
partial Codex CLI model-plan coverage and unknown direct plan API coverage. GitHub
Copilot has partial coverage from its qualified plan and client sources. Other
products report unknown model-plan coverage until an adapter is qualified.

Codex is included in ChatGPT plans. See the official
[ChatGPT and Codex pricing guide](https://learn.chatgpt.com/docs/pricing).
The `chatgpt` route groups Codex access under that subscription. It retains
`product: "openai-codex"` and the source `surface`. It does not claim complete coverage
of models in ChatGPT Chat. The source plan tokens are not renamed or expanded.
`data/subscriptions.json` owns the reviewed subscription-to-product mapping and integration
profiles. `src/subscriptions.ts` validates and exposes that data. An unknown product in a resolved
subscription declaration fails composition instead of selecting a guessed subscription.

`integration` describes documented access methods. See the [integration contract](integrations.md).
These methods do not create model-plan declarations. `model_catalog` reports source coverage
for each product. `partial` means that a qualified source exists; it does not mean complete
account coverage. `unknown` means that no model-plan adapter is qualified. Source state
remains explicit when a covered product is stale. A response can have documented methods,
`models: {}`, and unknown model coverage at the same time.

Subscription model keys and IDs are canonical models.dev IDs, such as `openai/gpt-6-sol`.
The model fields come from the upstream canonical `models` map. The response attaches
only entries for the selected subscription. Copilot can therefore contain OpenAI,
Anthropic, and other vendors without including ChatGPT access declarations.
The response does not copy another provider's endpoint or credentials into that service.

The response retains `unknown`, `unavailable`, and stale entries for inspection.
A missing or unresolved canonical model is omitted. Its source declaration remains in
`catalog.json`. Only entries with `state: "current"` and `status: "available"` establish
current declared support for their scope. Account access is not verified.
Source definitions contain only the evidence used in that subscription response.

## Static output

`bun run build` fetches the upstream catalog once and creates these files. It does not
store the full upstream model database in version control.

| File | Content |
| --- | --- |
| `index.json` | Provider and subscription routes, with upstream content digest |
| `providers/<provider>.json` | Original provider models with subscription metadata |
| `subscriptions/<subscription>.json` | Canonical models and entries for one subscription |
| `subscriptions.json` | Reviewed subscription definitions and integration profiles |
| `connections.json` | Documented connection categories and direct API-key provider references |
| `connections.schema.json` | Connection discovery schema |
| `provider-research.json` | Complete current provider review coverage and source evidence |
| `provider-research.schema.json` | Provider review response schema |
| `subscriptions.schema.json` | Definition manifest schema |
| `subscription.schema.json` | Subscription response schema |
| `provider.schema.json` | Composed provider response schema |
| `catalog.json` | Complete declaration layer, including stale and unresolved records |
| `catalog.schema.json` | Declaration schema |
| `coverage.json` | Supported plans, status counts, unresolved identities, and coverage gaps |
| `health.json` | Reviewed declaration state, source dates, and content digest |

For example, `providers/openai.json` returns OpenAI's upstream models with embedded
subscription entries. There are no separate files for products or plans. Use `index.json`
to discover provider and subscription paths. Path segments are URL-encoded. The host only serves files.
Query parameters do not compute filter combinations. Filter the arrays in the client.

A static response contains both upstream metadata and subscription provenance. A frontend
needs no synchronization library or additional models.dev request to consume it.

```ts
const response = await fetch(`${baseUrl}/subscriptions/chatgpt.json`);
if (!response.ok) throw new Error("Provider catalog is unavailable");
const subscription = await response.json();
const models = Object.values(subscription.models).filter((model) =>
  model.subscription_access.some((access) =>
    access.product === "openai-codex" &&
    access.plans.includes("plus") &&
    access.state === "current" &&
    access.status === "available"
  )
);
```

## TypeScript composition

The helpers run in a compatible Bun or Node toolchain. The caller supplies an upstream
snapshot and its content digest when composing data directly.

```ts
import { composeProvider, composeSubscription } from "./src/index.ts";

const provider = composeProvider(upstream, registry, "openai", upstreamSha256);
const chatgpt = composeSubscription(upstream, registry, "chatgpt", upstreamSha256);
```

`query` remains available for direct inspection of declaration records. It supports
product, plan, model, surface, channel, status, and freshness selection. An API offering
in upstream does not generate a subscription claim by itself.
