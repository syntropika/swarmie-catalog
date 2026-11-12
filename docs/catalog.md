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
`models` map. Each model receives a `subscription_access` object. The provider receives
`subscription_catalog` metadata with source definitions and the upstream content digest.
The complete response schema is [`provider.schema.json`](../schemas/provider.schema.json).

`subscription_access` contains the resolved `model_id`, an aggregate `status`, a reason,
and scoped `offers`. The aggregate status is `available` if at least one current source
declares subscription support. It is `unknown` otherwise. A set of negative declarations
for known plans cannot establish a global subscription exclusion.

Each offer identifies the subscription service provider, product, plan, client, source
status, source health, and evidence. An OpenAI model can have offers from OpenAI Codex
and GitHub Copilot. Those declarations do not change the original provider endpoint,
credentials, pricing, or account authority.

The composer uses explicit canonical links or an exact canonical provider/model ID.
A missing or broken canonical identity produces `unknown` with the reason
`unresolved-canonical-identity`. The original metadata remains intact. No guessed
identity or subscription claim is attached.

## Static output

`bun run build` fetches the upstream catalog once and creates these files. It does not
store the full upstream model database in version control.

| File | Content |
| --- | --- |
| `index.json` | Provider routes and known product-plan selections |
| `providers/<provider>.json` | Original provider models with subscription metadata |
| `providers/<provider>/subscriptions.json` | Models with current, explicit subscription support |
| `providers/<provider>/products/<product>.json` | Models with current, explicit support for that product |
| `providers/<provider>/products/<product>/plans/<plan>.json` | Models with current, explicit support for that product and plan |
| `provider.schema.json` | Composed provider response schema |
| `catalog.json` | Complete declaration layer, including stale and unresolved records |
| `catalog.schema.json` | Declaration schema |
| `coverage.json` | Supported plans, status counts, unresolved identities, and coverage gaps |
| `health.json` | Reviewed declaration state, source dates, and content digest |

For example, `providers/openai.json` returns OpenAI's upstream models. The path
`providers/openai/products/openai-codex/plans/plus.json` selects the models with explicit
Codex Plus declarations. The same provider can also be selected by a Copilot plan.
Product and plan tokens retain their source namespaces.

Filtered responses contain `subscription_catalog.selection` with `status: "available"`.
Their offer lists are scoped to the requested product and plan. Unknown, unavailable,
and stale-only models are not selected. Their omission is not a denial of account access.
Use the complete provider response to inspect those states.

Use `index.json` to discover exact paths. Path segments are URL-encoded. The host only
serves files. Query parameters do not compute new filter combinations. Additional
capability filters can run in the client.

A static response contains both upstream metadata and subscription provenance. A frontend
needs no synchronization library or additional models.dev request to consume it.

```ts
const response = await fetch(`${baseUrl}/providers/openai.json`);
if (!response.ok) throw new Error("Provider catalog is unavailable");
const provider = await response.json();
const models = Object.values(provider.models);
```

## TypeScript composition

The helpers run in a compatible Bun or Node toolchain. The caller supplies an upstream
snapshot and its content digest when composing data directly.

```ts
import { composeProvider, selectSubscriptionModels } from "./src/index.ts";

const provider = composeProvider(upstream, registry, "openai", upstreamSha256);
const plus = selectSubscriptionModels(provider, {
  product: "openai-codex",
  plan: "plus",
});
```

`query` remains available for direct inspection of declaration records. It supports
product, plan, model, surface, channel, status, and freshness selection. An API offering
in upstream does not generate a subscription claim by itself.
