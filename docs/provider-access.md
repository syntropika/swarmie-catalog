# Provider access and subscription policies

`provider-access.json` publishes primary-source research for the models.dev provider
inventory. It records subscription offerings, direct API-key access and scoped
subscription policies. Its `role` is `research-only`. It does not enable connections,
provide account models or grant application authority.

The owning data is `data/provider-access.json`. `src/provider-access.ts` validates it,
classifies positive findings and composes the current upstream inventory. The public
schema is `provider-access.schema.json`.

## Classification

| Category | Evidence |
| --- | --- |
| `both` | A subscription product and direct model API-key access are documented |
| `subscription` | A subscription product is documented; direct API-key access is not confirmed |
| `api-key` | Direct model API-key access is documented; a subscription is not confirmed |
| `unconfirmed` | Neither access finding has sufficient positive evidence |

These categories describe confirmed findings. They do not prove exclusive commercial
availability. `not-found` means no qualifying evidence was found in the inspected
sources. `unknown` means evidence was unavailable, incomplete or unresolved.

A subscription can cover direct inference, a coding agent, a chat application,
platform seats or compute. Each `plans[]` entry has its own `scope`. A chat application
subscription does not establish a model API entitlement. An agent-only API key does
not establish direct application access. Such credentials belong in the plan record.
`api_key_funding` distinguishes subscription-funded keys, separately metered usage and
BYOK. A finding of `both` does not mean that API calls use subscription credit.
Regional and plan-specific provider IDs remain distinct. Counts describe provider
entries, not unique companies or distinct subscription products.

## Plans and policies

Each plan records its name, scope, authentication, third-party use status, required
clients, constraints and source URLs. `supported` applies only to the stated plan and
conditions. Read its constraints before selecting an integration.

Each policy records a named product or route in `scope`, a `topic`, a `status`, a
factual summary and source URLs. Topics include third-party use, automation,
credentials, model access, billing, privacy, region, quotas and client requirements.
An explicit prohibition requires supporting source text. Silence remains unknown.
Do not apply one route's rule to all services offered by the same provider.

Research can distinguish personal applications from production or commercial use,
client requirements from direct API protocols, website scraping from inference API
automation, and raw service resale from supported applications. It also records
optional extra usage, paid fallback, nonrenewing legacy plans, shared quotas,
training settings and retention exceptions. These distinctions are not collapsed
into a provider-wide permission flag.

`limitations` preserves contradictions, source failures and unresolved conditions.
A marketing claim does not remove a restriction from product-specific terms.
A source-backed allowance is not proof of account eligibility or completed inference.
Use the [connection contract](integrations.md) for executable discovery requirements.

## Evidence and freshness

Each source has its URL, capture kind, review date and retained-content SHA-256 when
available. `http-body` and `web-extract` require actual retained bytes and a digest.
`retained-reference` can have a null digest when the inherited reference is all that
is established. A source digest does not make a mutable page immutable.

`evidence_mode` distinguishes fresh checks, retained evidence, mixed reviews and
unreviewed providers. Reused evidence keeps its original review date. The manifest's
review date identifies the consolidated investigation. It does not claim that every
source was fetched on that date.

New models.dev providers receive unknown findings and `evidence_mode: "unreviewed"`.
They do not inherit another provider's classification. The captured snapshot digest
and current upstream digest remain separate. Scheduled public synchronization does
not run this investigation or advance policy review dates. The older commercial
research endpoint retains its own scope and review dates; this detailed policy review
does not silently rewrite executable integration profiles.

## Static paths

| Path | Contents |
| --- | --- |
| `provider-access.json` | Current upstream providers, classification and scoped policies |
| `provider-access/categories/both.json` | Providers with both positive access findings |
| `provider-access/categories/subscription.json` | Subscription confirmed, direct API key unconfirmed |
| `provider-access/categories/api-key.json` | Direct API key confirmed, subscription unconfirmed |
| `provider-access/categories/unconfirmed.json` | Providers without either positive finding |
| `provider-access/providers/<provider>.json` | One provider review |

Each response uses the same public schema. Its `counts` describe only its own
`providers` array. `index.json` links to the complete research response and schema.
