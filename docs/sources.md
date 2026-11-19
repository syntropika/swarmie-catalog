# Sources, coverage, and extension

All production extraction is deterministic. It uses public official APIs, versioned
configuration and strict documentation tables. It uses no AI service, account login,
subscription credentials or private endpoint discovery.

## Research and executable coverage

`data/provider-research.json` owns commercial evidence and API-key findings.
`data/model-research.json` owns the separate review of subscription model discovery.
Each review preserves official URLs, known body digests, plan names, parser strategy
and limitations. A null digest means that this record has no verified retained body.
Research descriptions do not grant availability.

The model-source review covers every provider in its captured models.dev snapshot.
A new upstream provider has unknown status until reviewed. `not-found` is bounded to
the inspected sources. It does not prove that a provider sells no subscription.
A subscription can pay for an application, seats, routing, credits or reserved capacity.
None of these facts alone establishes included direct model API access.

`data/subscriptions.json` owns integration policy. `data/model-sources.json` selects
public source inputs and reviewed parsers. It contains no model availability rows.
Parsers live under `src/adapters/catalogs/`. Exact route scopes remain explicit.

The static outputs report public source coverage. Use `subscription-coverage.json`
for published and unavailable reference model responses. Use `connections.json` for
required client discovery procedures and per-route reference coverage. Use
`coverage.json` for native counts, plan tokens and unresolved IDs.
`data/connection-discovery.json` owns reviewed account and runtime discovery procedures.
The static publisher does not execute them. See the [client workflow](client-model-discovery.md).
A research profile can exist without an executable model adapter.

## Source contracts

| Source family | Required evidence |
| --- | --- |
| Product-specific catalog | Native IDs and explicit subscription scope or per-plan allowance |
| General model catalog with shared credits | A separate normative rule that the named plans fund that catalog |
| Plan-specific table | Exact model ID column, plan membership and table boundary |
| Coding-agent catalog | Supported native client, exact request model identity and subscription scope |
| Authenticated or incomplete source | Unknown model access, or an unavailable model catalog |

OpenCode Go publishes native IDs, per-plan monthly allowances, protocol URLs and
privacy or region flags. Free models additionally require zero input and output cost
and the documented free-model rule. Vercel Token Pass uses its own covered-model table,
Pro team requirement and serving-provider restriction. General Gateway models are not
added to Token Pass.

Other parsers preserve source-specific credit pools, editions, plan windows, provider
pinning, regions, lifecycle and modality restrictions. A nonchat model is not assigned
to a chat-only route. A source ID can remain visible with unknown plan membership.
A dynamic router or selector is not expanded into an invented list of underlying models.

A stale or critical source catalog fails refresh. A subscription-only catalog that
conflicts with a paid-only catalog retains the disputed models as unknown. Missing
request policies cannot borrow another model's quota or privacy terms.

### GitHub Copilot

The adapter reads the official
[plan table](https://github.com/github/docs/blob/main/data/tables/copilot/model-supported-plans.yml)
and [client table](https://github.com/github/docs/blob/main/data/tables/copilot/model-supported-clients.yml).
Each file is pinned to its latest path-specific commit. Missing plan cells stay unknown.
Explicit client exclusions remain exclusions. Unknown columns, duplicate rows or keys,
invalid booleans and unmatched client-only rows fail the update.

### OpenAI Codex and direct ChatGPT access

The adapter reads the official
[bundled model catalog](https://github.com/openai/codex/blob/main/codex-rs/models-manager/models.json).
It preserves exact plan tokens, visibility and minimum client versions. Hidden models
remain unknown. API support does not grant subscription access.

Bundled declarations are not an authenticated account catalog. They do not establish
the complete direct ChatGPT API model set. That public integration requires account
model discovery, which this unauthenticated synchronization does not perform.

### Unavailable or restricted sources

Claude and Google model defaults or model-family labels do not establish a complete
native model-to-plan mapping. An authenticated model endpoint is not probed with
private credentials. Public application plans do not imply arbitrary direct API access.

The current Chutes, DInference and Hostinger Router evidence does not establish an
active included-model subscription. Earlier plan names do not create current grants.
Other providers can remain unavailable because their model tables are inaccessible,
their native identifiers are missing, or their exact tier scope is unpublished.
Read each profile's sources and limitations in `model-research.json`.

## Failure and provenance

Public HTTP sources use explicit canonical URLs. Requests reject redirects, use bounded
body sizes and timeouts, and send no provider credentials. One synchronization reuses
identical public input bytes across adapters. GitHub tokens go only to GitHub metadata
requests. They do not authenticate raw source bodies or provider APIs.

The loader records each body digest. A GitHub source also records its commit and commit
date. HTTP sources do not receive fabricated Git revisions or publication dates.
Source observations and full captures remain in operational artifacts.

A provider refresh fails on structural drift, empty output, conflicting declarations
or excessive loss of models, identity links or positive scopes. Its last valid records
remain stale. An isolated unsupported model can remain unknown when the source parser
can prove its identity and the exact missing qualifier. Other providers can update.
A failed source never selects an archived fixture automatically.

## Add or update a source

1. Review the existing provider and model research.
2. Find official public native IDs and exact funding scope.
3. Verify client, region, modality and policy restrictions.
4. Add or update the owning integration definition when necessary.
5. Implement a pure parser with structural and semantic validation.
6. Register its parser ID and public sources in `data/model-sources.json`.
7. Preserve unknown native models and their evidence.
8. Add synthetic tests for exclusions, ambiguity and source drift.
9. Regenerate schemas and run `bun run check`.
10. Run a live synchronization and inspect its health report.

Do not add a manually maintained model allowlist to fill an evidence gap.
Keep source HTML, research experiments and operational reports under `.artifacts/`.
Keep versioned deliverables and source contracts with their owning modules.
