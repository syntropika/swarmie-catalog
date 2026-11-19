# Connections and model discovery

`connections.json` is the access-method catalog. It uses `schema_version: 3`.
It contains one `connections` array for subscription routes, agent routes and reviewed
API-key providers. Each connection has a stable `id` in the form `service/route`.
Its `path` points to the same connection as a standalone JSON file.
The owning contracts are [`connection.schema.json`](../schemas/connection.schema.json)
and [`connections.schema.json`](../schemas/connections.schema.json).

## Independent connection fields

| Field | Meaning |
| --- | --- |
| `service_id`, `route_id` | Credential service and integration route |
| `provider_ids` | Related models.dev providers from reviewed commercial evidence |
| `products` | Source product namespaces; empty when no product namespace is established |
| `execution` | `direct-model`, `coding-agent`, or `unknown` |
| `transport` | Interface kind, protocols, documented endpoints and required clients |
| `authentication.methods` | Documented credential methods |
| `authentication.oauth_scopes` | Required reviewed OAuth scopes; null when not established or not applicable |
| `billing.kind` | `subscription`, `usage-based`, `byok`, or `unknown` |
| `billing.models` | Reviewed funding descriptions for this connection |
| `billing.subscription_id` | Subscription identity, or null for separate API billing |
| `support` | Documentation status for the stated integration scope |
| `third_party_use`, `automation` | `supported`, `restricted`, or `unknown` under the constraints |
| `constraints` | Application eligibility, client, privacy, quota and use restrictions |
| `sources`, `reviewed_on` | Reviewed public evidence and review date |
| `model_discovery` | Required client discovery procedure and invalidation rules |
| `reference_catalog` | Public model evidence with `role: "reference-only"` |

Execution, authentication and billing are independent. An API key can fund a direct
subscription. A coding agent can use subscription credentials or a separately billed
API key. An SDK transport does not establish whether an integration runs an agent.
`account-login` records native login when the underlying protocol is not established.
It does not establish an OAuth contract. Empty endpoint or protocol arrays mean that
this catalog has no qualified value. They do not authorize a guessed endpoint.
A service's credentials do not apply to another service that sells the same model.

`provider_ids` link commercial services to providers. They do not identify every model
vendor that a multi-model service can serve. Native model discovery establishes those
choices. `reference_catalog.path` can be null. A non-null reference can contain models
for several routes of the same subscription. Filter its declarations by `route_ids`
when inspecting route-specific public evidence.

## Required client discovery

Every connection declares `model_discovery.requirement: "required"` and
`static_fallback: false`. A conforming client must obtain models through the selected
connection before it permits model selection. The static catalog contains no
account-specific model list and grants no model access.

The client binds discovery results to the connection, account, workspace,
authorization state and runtime configuration. It discovers models on connection.
It discards results when any bound context changes. It repeats discovery after a
model rejection. The client must discard results from a request that completes after
its context was invalidated. Do not share discovery caches between connections.

`model_discovery.method.kind: "documented"` supplies reviewed discovery steps.
`http` steps specify a GET URL and the response format. They use the selected
connection's credentials. `json-rpc` steps specify a runtime method and parameters.
The host must initialize the runtime with the selected connection's credentials and
provider configuration. The host owns transport, credentials, process lifecycle and
RPC initialization. The catalog does not execute requests or commands.

Run all steps. Follow all runtime pages using `nextCursor` as the next `cursor`.
Pass successful response bodies or unwrapped RPC results to the response parser.
Combine steps by the intersection of their exact native request IDs. Preserve the
first step's ordering and names. Do not lowercase, alias or guess these identifiers.
An empty successful result offers no selectable models. An error, malformed response
or incomplete page sequence must leave selection unavailable. No static fallback is
permitted. Listing a model does not establish its quotas, protocol features or final
inference authorization. A runtime can return a bundled or cached model list.

`method.kind: "unavailable"` means no discovery method has been reviewed. A conforming
client cannot enable model selection through that connection. Keep the commercial
facts and sources available for inspection. Do not assume an OpenAI-compatible
`/models` endpoint merely because a service has a compatible inference endpoint.

## OpenAI access methods

| Connection ID | Authentication and billing | Discovery |
| --- | --- | --- |
| `chatgpt/chatgpt-plan-direct-responses` | OAuth permission to use a ChatGPT plan; direct inference | Account `GET /v1/models`, using `models[].slug` |
| `chatgpt/codex-app-server-chatgpt` | ChatGPT plan OAuth through Codex app-server | Account model list intersected with Codex `model/list` |
| `chatgpt/codex-cli-chatgpt` | Native ChatGPT login; Codex execution | Codex `model/list`; runtime choices can be cached |
| `chatgpt/codex-cli-api-key` | API key; Codex execution with separate API billing | API model list intersected with Codex `model/list` |
| `openai/api-key` | API key; direct inference with separate API billing | Account `GET /v1/models`, using `data[].id` |

The OAuth plan API and API-key API use different model response formats even though
they use the same public model-list URL. The OAuth route requires the
`chatgpt.tokens.use.direct` scope. It must meet application eligibility and preview
requirements. It does not require a coding-agent runtime.
The native Codex login route does not authorize reuse of its tokens for the plan API.
See OpenAI's [plan model discovery](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[Codex model discovery](https://learn.chatgpt.com/docs/app-server#list-models-modellist),
and [API model discovery](https://developers.openai.com/api/reference/resources/models/methods/list).

## Static routes and filters

| Path | Contents |
| --- | --- |
| `connections.json` | All documented connections |
| `connections/direct-subscriptions.json` | Direct model execution funded by a subscription |
| `connections/direct-api.json` | Direct model execution without subscription billing |
| `connections/coding-agents.json` | Coding-agent execution with either funding method |
| `connections/services/<service>/index.json` | Connections owned by one service |
| `connections/services/<service>/routes/<route>.json` | One connection |
| `connections/providers/<provider>.json` | Connections related to one models.dev provider |

Use `index.json` for group and service paths. Group responses use the same connections
schema. Their `research_coverage` describes the complete upstream research inventory.
These files are static. Query parameters do not compute filters.

```ts
import { connectionsSchema } from "swarmie-catalog";

const response = await fetch(`${baseUrl}/connections/direct-subscriptions.json`);
if (!response.ok) throw new Error("Connections are unavailable");
const catalog = connectionsSchema.parse(await response.json());
const candidates = catalog.connections.filter((connection) =>
  connection.model_discovery.method.kind === "documented"
);
```

These candidates have reviewed discovery procedures. Check application eligibility,
required consent and constraints before authentication. They are not account-qualified
model selections. `resolveDiscoveredModels` resolves complete results for the current
connection and context. Its host must create and invalidate the opaque context key.
See the [client workflow](client-model-discovery.md) for the transport boundary.

## Source ownership

`data/subscriptions.json` contains reviewed subscription integration profiles. Its
manifest uses `schema_version: 2`. It remains available at `subscriptions.json` and
inside subscription reference views. `src/integration-schema.ts` validates it.
`data/provider-research.json` supplies reviewed direct API-key commercial facts.
`data/connection-discovery.json` supplies reviewed connection discovery procedures.
It contains no model availability lists. `src/discovery.ts` owns its validation and
response parsing. `src/connections.ts` composes the public connection contract.

Each reviewed source has a public URL, a retained-capture SHA-256 digest and a capture
kind. A digest identifies reviewed bytes. It does not make a mutable URL immutable.
Scheduled public model synchronization does not advance integration or discovery
review dates. Update source captures, digests and facts together after review.
Preserve unresolved procedures as unavailable. The static publisher never logs in,
handles provider credentials or discovers a user's models.
