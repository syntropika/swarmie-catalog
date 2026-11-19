# Client model discovery

Clients obtain the selected connection from `connections.json` or its standalone
path. Validate that JSON with `connectionSchema` or `connectionsSchema`.
`model_discovery` is required for every connection. See the owning
[connection contract](integrations.md) for its fields and static routes.

The host supplies authentication, HTTP, runtime initialization and pagination.
The catalog library supplies synchronous response parsing and result resolution.
It does not manage credentials, launch agents or send inference requests.

## Client sequence

1. Select a connection and inspect its constraints.
2. Refuse selection if its discovery method is unavailable.
3. Authenticate through that connection and obtain required consent.
4. Create a new opaque context key for the current connection and authorization context.
5. Run each documented discovery step with the same credentials used for inference.
6. Fetch every runtime page before completing the step.
7. Discard the result if the current context changed during discovery.
8. Resolve the responses with `resolveDiscoveredModels`.
9. Show only the resolved native model IDs for this connection.
10. Enrich model details through exact models.dev offering identities where available.

Use `request_model_id` for inference. Keep a model when no exact models.dev identity
exists; its metadata is unresolved. Do not replace the native ID with a model key,
display name or fuzzy canonical match. Public plan vectors can explain published
conditions. They must not add or remove models from the discovered account list.
A listed model still requires supported request options and an accepted inference
response. Discovery does not establish unrestricted use, remaining quota or tool support.

## Direct ChatGPT example

This function accepts an already authorized OAuth token for the direct ChatGPT plan
connection. It does not implement sign-in. The host must grant the required scope and
meet OpenAI's application eligibility conditions. Browser clients can require a native
host or their own authorized transport. Static hosting does not remove CORS restrictions.

```ts
import {
  type Connection,
  resolveDiscoveredModels,
} from "swarmie-catalog";

async function discoverChatGPT(
  connection: Connection,
  contextKey: string,
  accessToken: string,
  signal: AbortSignal,
) {
  if (connection.id !== "chatgpt/chatgpt-plan-direct-responses") {
    throw new Error("Wrong connection");
  }
  const method = connection.model_discovery.method;
  if (method.kind !== "documented") throw new Error("Discovery is unavailable");
  const step = method.steps[0];
  if (!step || step.kind !== "http" || method.steps.length !== 1) {
    throw new Error("Unsupported discovery procedure");
  }
  const response = await fetch(step.url, {
    method: step.method,
    redirect: "error",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (!response.ok) throw new Error(`Model discovery failed: ${response.status}`);
  return {
    connection_id: connection.id,
    context_key: contextKey,
    steps: [[await response.json()]],
  };
}

// The host owns these values and changes the context key when authorization changes.
const result = await discoverChatGPT(connection, startedContextKey, token, signal);
const models = resolveDiscoveredModels(connection, currentContextKey, result);
```

A stale context throws `ModelDiscoveryError` with `code: "context-mismatch"`.
The helper also rejects missing methods, missing steps, malformed bodies, duplicate
IDs and incomplete page sequences. It preserves source ordering and exact native IDs.
It has no static model input and no fallback path.

## Runtime discovery

For a `json-rpc` step, start or reuse the required runtime under the selected account
and provider configuration. Complete its documented initialization and authentication.
Send the step's method and parameters. For Codex, pass a returned `nextCursor` as
`cursor` in the next `model/list` request. Continue until it returns null. Preserve
response order and pass the successful RPC `result` objects as that step's pages.
Do not pass JSON-RPC envelopes, failed RPC replies or unsolicited notifications.

`readModelPage` validates one body and returns normalized models plus `next_cursor`.
The host can use it while fetching pages. `resolveDiscoveredModels` validates all
steps and intersects their native IDs. The host must verify response IDs and cursor
requests, enforce bounds, stop on cancellation and propagate transport errors.
A parser cannot verify that the host used the correct credentials or requested cursor.

Native Codex discovery can use a bundled or cached list. The direct ChatGPT plan
app-server procedure also obtains the account's current list through OAuth. It exposes
only IDs shared by both results. The native Codex login procedure does not imply that
native login tokens work with the direct plan API.

On logout, account switch, workspace switch, credential or permission change, runtime
provider change, reconnect or model rejection, discard prior model selections and
results. Cancel pending discovery when possible. Never persist tokens in catalog data
or include them in context keys, logs or error messages.
