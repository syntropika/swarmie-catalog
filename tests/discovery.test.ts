import { expect, test } from "bun:test";
import { codex } from "../src/adapters/codex.ts";
import { type Connection, composeConnections, connectionSchema } from "../src/connections.ts";
import {
  discoveryProfilesSchema,
  ModelDiscoveryError,
  modelDiscoverySchema,
  readModelPage,
  resolveDiscoveredModels,
} from "../src/discovery.ts";
import { initial, upstream } from "./helpers.ts";

async function connections() {
  const { registry } = await initial([codex]);
  return composeConnections(await upstream(), "a".repeat(64), registry).connections;
}
function find(items: Connection[], id: string) {
  const connection = items.find((connection) => connection.id === id);
  if (!connection) throw new Error(`Missing connection: ${id}`);
  return connection;
}
const accountPage = {
  models: [
    { slug: "new/native-ID", display_name: "New account model", visibility: "list" },
    { slug: "hidden-model", display_name: "Hidden model", visibility: "hide" },
  ],
};

test("OpenAI has distinct direct OAuth, subscription runtime and API-key connections", async () => {
  const items = await connections();
  const direct = find(items, "chatgpt/chatgpt-plan-direct-responses");
  const runtime = find(items, "chatgpt/codex-cli-chatgpt");
  const api = find(items, "openai/api-key");
  const runtimeApi = find(items, "chatgpt/codex-cli-api-key");
  expect(direct.authentication.methods).toEqual(["oauth"]);
  expect(direct.authentication.oauth_scopes).toEqual(["chatgpt.tokens.use.direct"]);
  expect(direct.billing).toMatchObject({ kind: "subscription", subscription_id: "chatgpt" });
  expect(direct.execution).toBe("direct-model");
  expect(direct.transport.required_clients).toEqual([]);
  expect(direct.reference_catalog.status).toBe("unavailable");
  expect(direct.model_discovery.method.kind).toBe("documented");
  expect(runtime.execution).toBe("coding-agent");
  expect(runtime.billing.kind).toBe("subscription");
  expect(runtimeApi.execution).toBe("coding-agent");
  expect(runtimeApi.billing).toMatchObject({ kind: "usage-based", subscription_id: null });
  expect(api.authentication.methods).toEqual(["api-key"]);
  expect(api.billing).toMatchObject({ kind: "usage-based", subscription_id: null });
  expect(api.model_discovery.method).toMatchObject({ steps: [{ format: "openai-models" }] });
  expect(direct.model_discovery.method).toMatchObject({ steps: [{ format: "chatgpt-models" }] });
  expect(items.filter((connection) => connection.provider_ids.includes("openai"))).toHaveLength(5);
});

test("account discovery preserves new native IDs absent from the static catalog", async () => {
  const direct = find(await connections(), "chatgpt/chatgpt-plan-direct-responses");
  const models = resolveDiscoveredModels(direct, "account-a/workspace-a/auth-1", {
    connection_id: direct.id,
    context_key: "account-a/workspace-a/auth-1",
    steps: [[accountPage]],
  });
  expect(models).toEqual([{ request_model_id: "new/native-ID", name: "New account model" }]);
  expect(readModelPage("openai-models", { data: [{ id: "Exact/ID" }] }).models).toEqual([
    { request_model_id: "Exact/ID", name: "Exact/ID" },
  ]);
});

test("discovery cannot cross connections or retain results after a context change", async () => {
  const direct = find(await connections(), "chatgpt/chatgpt-plan-direct-responses");
  const result = { connection_id: direct.id, context_key: "old-auth", steps: [[accountPage]] };
  expect(() => resolveDiscoveredModels(direct, "new-auth", result)).toThrow("context-mismatch");
  expect(() => resolveDiscoveredModels(direct, "", result)).toThrow("context-mismatch");
  expect(() =>
    resolveDiscoveredModels(direct, "old-auth", {
      ...result,
      connection_id: "openai/api-key",
    }),
  ).toThrow("context-mismatch");
});

test("Codex plan API results intersect current account models with fully paginated runtime choices", async () => {
  const connection = find(await connections(), "chatgpt/codex-app-server-chatgpt");
  const result = {
    connection_id: connection.id,
    context_key: "selected-account-and-runtime",
    steps: [
      [accountPage],
      [
        {
          data: [{ model: "runtime-only", displayName: "Runtime only", hidden: false }],
          nextCursor: "page-2",
        },
        {
          data: [{ model: "new/native-ID", displayName: "Runtime name", hidden: false }],
          nextCursor: null,
        },
      ],
    ],
  };
  expect(resolveDiscoveredModels(connection, result.context_key, result)).toEqual([
    { request_model_id: "new/native-ID", name: "New account model" },
  ]);
  result.steps[1]?.pop();
  expect(() => resolveDiscoveredModels(connection, result.context_key, result)).toThrow(
    "incomplete",
  );
});

test("missing methods, invalid replies and incomplete discovery never use public references", async () => {
  const items = await connections();
  const unavailable = items.find(
    (connection) => connection.model_discovery.method.kind === "unavailable",
  );
  if (!unavailable) throw new Error("Missing unavailable discovery fixture");
  expect(() =>
    resolveDiscoveredModels(unavailable, "ctx", {
      connection_id: unavailable.id,
      context_key: "ctx",
      steps: [],
    }),
  ).toThrow("unavailable");
  const connection = find(items, "chatgpt/chatgpt-plan-direct-responses");
  const result = { connection_id: connection.id, context_key: "ctx", steps: [] as unknown[][] };
  expect(() => resolveDiscoveredModels(connection, "ctx", result)).toThrow("incomplete");
  result.steps = [[{ data: [{ id: "api-key-format-is-wrong-for-oauth" }] }]];
  expect(() => resolveDiscoveredModels(connection, "ctx", result)).toThrow("invalid-response");
  result.steps = [[{ error: "unauthorized" }]];
  expect(() => resolveDiscoveredModels(connection, "ctx", result)).toThrow(ModelDiscoveryError);
  result.steps = [[{ models: [] }]];
  expect(resolveDiscoveredModels(connection, "ctx", result)).toEqual([]);
});

test("malformed pagination, duplicate native IDs and hidden runtime entries fail closed", async () => {
  const connection = find(await connections(), "chatgpt/codex-cli-chatgpt");
  const page = {
    data: [{ model: "native", displayName: "Native", hidden: false }],
    nextCursor: null,
  };
  const result = { connection_id: connection.id, context_key: "ctx", steps: [[page, page]] };
  expect(() => resolveDiscoveredModels(connection, "ctx", result)).toThrow("invalid-response");
  expect(() =>
    resolveDiscoveredModels(connection, "ctx", {
      ...result,
      steps: [[{ ...page, data: [...page.data, ...page.data] }]],
    }),
  ).toThrow("invalid-response");
  expect(() =>
    resolveDiscoveredModels(connection, "ctx", {
      ...result,
      steps: [[{ ...page, nextCursor: "same" }, { ...page, nextCursor: "same" }, page]],
    }),
  ).toThrow("incomplete");
  expect(
    readModelPage("codex-models", {
      ...page,
      data: [{ model: "hidden", displayName: "Hidden", hidden: true }],
    }).models,
  ).toEqual([]);
});

test("public contracts reject static fallbacks, wrong credentials and invented runtime requirements", async () => {
  const direct = find(await connections(), "chatgpt/chatgpt-plan-direct-responses");
  expect(
    modelDiscoverySchema.safeParse({ ...direct.model_discovery, static_fallback: true }).success,
  ).toBe(false);
  expect(
    connectionSchema.safeParse({
      ...direct,
      authentication: { methods: ["api-key"], oauth_scopes: null },
    }).success,
  ).toBe(false);
  const runtime = find(await connections(), "chatgpt/codex-cli-chatgpt");
  expect(
    connectionSchema.safeParse({
      ...runtime,
      transport: { ...runtime.transport, required_clients: [] },
    }).success,
  ).toBe(false);
  expect(
    connectionSchema.safeParse({ ...direct, billing: { ...direct.billing, kind: "usage-based" } })
      .success,
  ).toBe(false);
  const method = direct.model_discovery.method;
  if (method.kind !== "documented") throw new Error("Missing documented fixture");
  expect(
    discoveryProfilesSchema.safeParse({
      schema_version: 1,
      profiles: [
        {
          connection_id: direct.id,
          oauth_scopes: ["chatgpt.tokens.use.direct"],
          method: { ...method, sources: [] },
        },
      ],
    }).success,
  ).toBe(false);
});
