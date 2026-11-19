# Data contract and consumption

The declaration registry uses `schema_version: 2`. Composed provider and subscription
metadata uses `subscription_catalog.schema_version: 4`. Connection discovery uses
`schema_version: 3`. The static index uses `schema_version: 4`.
The owning contracts are in `src/schema.ts`, `src/connections.ts` and `src/discovery.ts`.
Composed model catalogs have `role: "reference-only"` and
`model_selection: "connection-discovery-required"`. Clients obtain account model choices
through the selected connection. These public declarations do not grant account access.

## Declarations and identity

| Field | Contract |
| --- | --- |
| `product` | Subscription product namespace |
| `provider` | Source service namespace |
| `offering_provider` | Exact models.dev provider used for offering identity lookup |
| `source_model` | Exact source label or native identifier |
| `request_model_id` | Exact native request identifier, or `null` if not established |
| `model_id` | Exact models.dev canonical identity, or `null` if unresolved |
| `route_ids` | Qualified integration routes within the subscription |
| `request_api` | Source API URL references, indexed by protocol |
| `conditions` | Source qualifiers for regions, privacy, quotas, lifecycle and route scope |
| `channel` | `subscription` or separately billed `api` |
| `plan` | Product-specific source plan identifier, or unspecified `null` |
| `surface` | Source client token, or product-level `null` |
| `variant` | Explicit identity variant, or `null` |
| `minimum_client_version` | Source client requirement, or `null` |
| `status` | `available`, `unavailable`, or `unknown` within the record scope |
| `reason` | Explanation code |
| `evidence` | Source IDs and exact source locators |

`available` records explicit source inclusion. `unavailable` records explicit exclusion.
`unknown` preserves insufficient or conflicting evidence. An absent record has no
implicit status. A null plan is unspecified. It is not an all-plans grant.

Source inclusion does not establish account authorization, organization approval,
remaining quota or current request acceptance. A `stale` source owner makes its
records historical. A documented model can have no qualified route for its modality.
An empty `route_ids` array grants no request route.

Canonical identity and native request identity are separate. Exact provider offering
links take precedence over a canonical-ID fallback. Copilot labels use the documented
models.dev punctuation rule. Other native identifiers preserve their exact case.
No edit-distance match, model-family expansion or guessed version is permitted.
A missing or conflicting canonical link leaves the source model unresolved. It does
not erase its native subscription declaration. Mass identity loss still fails refresh.

`data/aliases.json` supports reviewed exact identity mappings. Each mapping requires
an existing canonical target and an official source. It cannot create availability.

Each source has a URL, SHA-256 body digest and locators. GitHub sources also have their
pinned commit and commit date. Public HTTP sources use null revision and modification
date when the source does not supply those values. Check time is operational evidence;
it is not a fabricated source publication date. HTTP URLs can change.

## Provider and subscription views

`providers/<provider>.json` preserves every models.dev offering and its original fields.
Each model receives `subscription_access`. Entries from different subscriptions can
refer to the same canonical model. This does not transfer one service's credentials,
endpoint or billing to another service.

`subscriptions/<subscription>.json` contains models for one subscription across model
vendors. ChatGPT groups Codex under `product: "openai-codex"`. Codex evidence does not
establish the direct ChatGPT plan API catalog. Copilot remains a separate subscription.
OpenCode Go has its own subscription namespace. General Zen access does not grant Go access.

Each subscription entry has a `plans` vector instead of the registry's scalar `plan`.
Plans share an entry only when all other access conditions match. Different routes,
allowances, editions, regions or privacy conditions can require separate entries.
Source identifiers remain exact. Edition-qualified plan IDs keep Personal and Team
plans with the same display label separate. Their original names remain in conditions.

Resolved model keys use canonical models.dev IDs. Unresolved keys use
`<product>/<URL-encoded native identifier>`. Only resolved models receive canonical
models.dev metadata. Unresolved models keep their source identity and declarations.
Never use a response model key as the request model ID. Use `request_model_id` from
the selected entry. The caller's provider adapter still owns request validation,
transport and credentials. `request_api` records source URL references; a source can
name a base URL or a full endpoint. It does not create a generic inference client.

Subscription model responses are always nonempty. A subscription without a model
source has no model-response file or index path. `subscription-coverage.json` reports
it under `unavailable`, with its integration evidence. `subscriptions.json` remains
the complete reviewed integration manifest.

`model_catalog.status: "partial"` means that source model records exist. It does not
claim complete account coverage or that every record is available. Product counts
separate native models, available models and unresolved canonical identities.
`unavailable` means that no model records exist for that product. Unknown native model
records remain visible and cannot make a connection route ready.

## Static discovery and filtering

| File | Content |
| --- | --- |
| `index.json` | Nonempty subscription model paths and all upstream provider paths |
| `providers/<provider>.json` | Complete upstream provider offerings and joined declarations |
| `subscriptions/<subscription>.json` | Source model records for one subscription |
| `subscriptions.json` | Reviewed integration definitions |
| `subscription-coverage.json` | Published paths and explicit unavailable model catalogs |
| `connections.json` | Unified connections with authentication, billing, execution and required discovery |
| `provider-research.json` | Commercial review and direct API-key evidence |
| `model-research.json` | Provider-by-provider discovery sources, plans, parser strategies and limitations |
| `model-sources.json` | Executable public source definitions, without model allowlists |
| `catalog.json` | All declarations, including stale and unresolved records |
| `coverage.json` | Plan tokens, source coverage, status counts and identity gaps |
| `health.json` | Declaration source state, errors and digest |
| `*.schema.json` | Owning JSON contracts |

The server only serves files. Query parameters do not compute filters. A frontend
filters reference entries locally. Model selection requires connection discovery.

Connection discovery is independent of reference model coverage. A connection can
have a reviewed discovery procedure without a public subscription model list.
`reference_catalog` records public evidence. It does not establish selectable models.
Use the [connection contract](integrations.md) and [client workflow](client-model-discovery.md)
for required account or runtime discovery, context invalidation and source formats.

Per-model `conditions.route_protocols` can narrow a route's general protocols.
Required headers, privacy, region, client and quota conditions also apply. Source
membership never grants application authority or permission to reuse a native token.

## TypeScript use

`composeProvider` and `composeSubscription` accept the upstream snapshot, registry,
namespace and upstream digest. `composeSubscription` throws
`ModelCatalogUnavailableError` when no model records exist.
`createCatalogComposer` reuses one model index for several views of immutable snapshots.
`composeConnections` also requires the registry to report public reference coverage.
`resolveDiscoveredModels` accepts complete client discovery results for the current
connection context. It never reads reference model declarations.
`query` inspects scalar declarations. Its default filters omit stale sources and
unresolved canonical identities. Use `includeUnresolved` to inspect native records.
