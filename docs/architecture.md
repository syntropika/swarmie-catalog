# Architecture and synchronization

models.dev owns general model metadata. Swarmie Catalog owns only subscription
and access declarations. The catalog has no runtime dependency on Swarmie.

## Upstream integration

The engine consumes `https://models.dev/catalog.json?type=all`. Its `models` map
contains canonical model metadata. Its `providers` map contains provider offerings.
An offering can identify its canonical model with `canonical_model_id`.
The engine validates these identity fields and preserves other metadata at the boundary.
It does not copy the full catalog into version control.

Upstream publishes the provider map separately at `/api.json` and the canonical map
at `/models.json`. The combined endpoint avoids mixing separately retrieved versions.
The repository-root `models.json` in upstream is a different, OpenRouter-shaped file.
It must not be used as the public canonical endpoint.

These contracts were checked against upstream
[generator code](https://github.com/anomalyco/models.dev/blob/dev/packages/core/src/generate.ts),
[build code](https://github.com/anomalyco/models.dev/blob/dev/packages/web/script/build.ts),
and [routes](https://github.com/anomalyco/models.dev/blob/dev/packages/function/src/worker.ts).
Upstream uses provider adapters, schema validation, Bun, and scheduled sync jobs.
Its deployment uses Cloudflare Workers and SST. This project consumes its public data
and does not copy that deployment or its agent workflows.

## Synchronization stages

1. Fetch and validate the combined upstream catalog.
2. Resolve each official source path to its latest file commit.
3. Fetch the immutable source URL.
4. Verify each source digest.
5. Parse each provider source with its adapter.
6. Resolve exact canonical identities.
7. Validate scopes, conflicts, and deletion limits.
8. Replace each successful provider as one unit.
9. Write sorted JSON and a run report.

Fetching, parsing, identity resolution, reconciliation, and publication have separate owners.
Adapters do not write catalog files or publish branches. Remote text is parsed as data.
No extracted program or instruction is executed.

Requests have a 30-second timeout and a 32 MB body limit. HTTP errors, redirects,
empty bodies, invalid schemas, and digest mismatches fail visibly.
GitHub discovery uses the public commits API. Actions supplies its built-in repository
token for revision metadata requests to avoid shared anonymous rate limits. Raw source
requests do not receive that token. Local runs can omit it. No subscription credentials
are used. Rate limits can still cause a run to fail. The next scheduled run can retry.

## Failure handling

A provider failure retains its previous records and marks the provider `stale`.
The error field contains a stable error code. The run report contains diagnostic details.
Other providers can still update. A failure on the initial run produces no claims for
that provider and a visible run failure. An upstream failure retains all previous
providers and marks them stale.

An empty provider result is rejected. A change is rejected if more than 20% of
previously listed model names disappear or more than 35% of positive scopes lose
availability. An update also fails if more than 20% of previously resolved scopes lose
their canonical identity. These guards apply per provider. Review the source and code before
changing a threshold. There is no automatic deletion override.

A smaller disappearance retains the old scope as `unknown`. The reason is
`source-no-longer-lists-scope`. Its original source evidence remains available.
It does not become an explicit denial. Historical sources are retained only while
records reference them. Conflicting records reject the provider update.
Identical duplicate claims are combined. Duplicate source rows are rejected.

## Determinism and freshness

The serializer sorts object keys. The engine sorts providers, sources, claims, and evidence.
No local path, retrieval clock, or formatting variation affects record order.
Identical inputs produce identical catalog bytes when synchronized against the same baseline.

`source_updated_at` is the latest commit time of the evidence snapshots for a provider.
It is a source date, not a verification time or an account access check.
If the interpreted declarations do not change, the engine retains their original
source references. Formatting-only changes do not create catalog diffs.
The run artifact still captures the newly fetched revisions and bytes.

Each run writes `checked_at`, verified provider IDs, errors, and the catalog digest to
`.artifacts/reports/sync/health.json`. This is the last successful verification time for each provider listed in `verified`.
A failed provider receives no new verification time. It saves the exact input snapshots under
`.artifacts/reports/sync/inputs/`. GitHub uploads these as run artifacts, including failed runs.
This separates last-run freshness from stable catalog content. Inspect the latest run
artifact and Actions status for the latest check. A static distribution is a reviewed
snapshot and does not claim to show the latest attempted synchronization.
