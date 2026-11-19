# Subscription integration profiles

`data/subscriptions.json` records reviewed public integration facts. The static build
publishes it at `subscriptions.json`. Each subscription response includes its profile
under `integration`. The manifest schema is
[`subscriptions.schema.json`](../schemas/subscriptions.schema.json).
`src/integration-schema.ts` owns validation.

## Route fields

| Field | Meaning |
| --- | --- |
| `id`, `name` | Route identity and display name |
| `kind` | `direct-api`, `cli`, or `sdk` |
| `execution` | `direct-model`, `coding-agent`, or `unknown` |
| `billing` | `subscription`, `usage-based`, `byok`, or `unknown` |
| `connection_kind` | Derived discovery category: `subscription`, `api-key`, `coding-agent`, or `unknown` |
| `products` | Product namespaces within this subscription |
| `support` | `documented`, `not-supported`, or `unknown` for the stated scope |
| `auth_methods` | Documented `oauth`, `account-login`, `api-key`, or `github-token` methods |
| `required_clients` | Required official clients, SDKs, runtimes, or approved tools |
| `protocols` | Documented interface or transport names |
| `endpoints` | Public documented URLs with protocols and an optional region |
| `third_party_use` | `supported`, `restricted`, or `unknown` under the route constraints |
| `automation` | `supported`, `restricted`, or `unknown` under the route constraints |
| `constraints` | Conditions and limits that apply to this route |
| `evidence` | References to documentation sources in the same profile |

`account-login` records a native client login when the underlying protocol is not
established. It must not be interpreted as an OAuth integration contract.
An empty endpoint list does not imply a reusable private API. A required runtime can
be an SDK-managed CLI or a native library; a CLI subprocess is not universal.

`documented` describes an official route. It does not verify an account, grant
application approval, or establish model access. Read `constraints` before selecting
any route. Restrictions can concern distribution, supported clients, interactive use,
account identity, or billing. `not-supported` records an explicit source restriction
for the stated scope. `unknown` preserves a question that the sources do not answer.

A subscription can use an API key. The key must belong to the subscription service
and endpoint. A separately billed API key does not inherit subscription benefits.
The catalog contains no keys, session tokens, token exchange logic, or inference code.
A subscription login does not authorize collection or reuse of native client tokens.

## Connection selection

`connections.json` contains documented routes and reviewed direct API-key providers.
Use its `routes` array for service integration methods. Use `provider_api_keys` for
direct provider credentials with usage billing or BYOK. Each provider entry links to
its provider catalog and research. These entries do not grant account access.
The response schema is [`connections.schema.json`](../schemas/connections.schema.json).

Select `connection_kind` for these application categories:

| Category | Rule |
| --- | --- |
| `subscription` | Direct model execution funded by a subscription, without a required coding-agent runtime |
| `api-key` | Direct model execution with separate usage billing or BYOK |
| `coding-agent` | A coding-agent runtime or a route limited to approved agent tools, with subscription or API-key funding |
| `unknown` | Evidence does not establish the required execution or billing scope |

Authentication does not select the category. A subscription can use an API key.
A coding agent can use either subscription login or a separately billed API key.
An SDK can run a complete agent or provide direct model transport. A local encryption
proxy does not become a coding agent. A plan restricted to approved agent tools does
not become a direct subscription because its transport is HTTP.

`support: "documented"` is required for connection discovery. `third_party_use`,
`automation`, `required_clients`, and `constraints` still apply to each result.
Unknown or unsupported routes remain in the full subscription profiles for inspection.

## Evidence and freshness

Each profile has `reviewed_on` and `sources`. A source contains its public URL and the
SHA-256 digest of a retained capture. `capture_kind` is `http-body` for an HTTP body
or `web-extract` for a retained public web extract. Route evidence refers to
these source IDs. Documentation URLs can change. A digest identifies reviewed content;
it does not make the URL immutable or assert that current content still matches.

Profiles are reviewed data. Scheduled model synchronization does not recheck their
policy text or advance their review dates. Update the facts, source digests, and
review date together after a new source review. Keep full source captures and reports
in the workspace artifact directory. Do not add source HTML to the model registry.

The manifest validator rejects duplicate subscriptions, shared product namespaces,
missing evidence, duplicate route IDs, unowned route products, undocumented endpoint
protocols, and contradictory route support. Public subscription validation also checks
the route evidence and product ownership.

## Model coverage

Integration facts do not populate `models` or `subscription_access`. Only qualified
model-plan adapters can produce those declarations. Existing source clients and plan
tokens retain their exact scopes. A general API integration must not inherit a CLI
model list. Unknown coverage is reported by `model_catalog`; see the
[data contract](catalog.md#subscription-routes).

Use `index.json` to discover subscription paths. For example, download
`subscriptions/claude.json` to inspect native client requirements, or
`subscriptions/kimi.json` to inspect the dedicated API and its usage limits.

```ts
const response = await fetch(`${baseUrl}/connections.json`);
if (!response.ok) throw new Error("Subscription definitions are unavailable");
const connections = await response.json();
const candidates = connections.routes.filter((route) =>
  route.connection_kind === "subscription"
);
```

This query discovers documented routes. Each candidate still carries its third-party
use status, automation status, requirements, and constraints. Discovery does not grant
permission to use a route or credentials.
