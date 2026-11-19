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

## Evidence and freshness

Each profile has `reviewed_on` and `sources`. A source contains its public URL and the
SHA-256 digest of the HTTP body inspected during review. Route evidence refers to
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
const response = await fetch(`${baseUrl}/subscriptions.json`);
if (!response.ok) throw new Error("Subscription definitions are unavailable");
const manifest = await response.json();
const candidates = manifest.subscriptions.flatMap((subscription) =>
  subscription.integration.routes
    .filter((route) => route.kind === "direct-api" && route.support === "documented")
    .map((route) => ({ subscription: subscription.id, route }))
);
```

This query discovers documented routes. Each candidate still carries its third-party
use status, automation status, requirements, and constraints. Discovery does not grant
permission to use a route or credentials.
