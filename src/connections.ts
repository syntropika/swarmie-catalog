import { z } from "zod";
import data from "../data/connection-discovery.json" with { type: "json" };
import {
  discoveryProfilesSchema,
  documentationSourceSchema,
  modelDiscovery,
  modelDiscoverySchema,
} from "./discovery.ts";
import { integrationRouteSchema } from "./integration-schema.ts";
import { composeProviderResearch, providerResearch } from "./provider-research.ts";
import type { Registry, Upstream } from "./schema.ts";
import { compare, hash } from "./stable.ts";
import { subscriptions } from "./subscriptions.ts";

export const discoveryProfiles = discoveryProfilesSchema.parse(data);
const text = z.string().min(1);
const route = integrationRouteSchema.shape;

export const connectionSchema = z
  .object({
    id: text,
    path: text,
    service_id: text,
    route_id: text,
    name: text,
    provider_ids: z.array(text),
    products: z.array(text),
    execution: route.execution,
    transport: z
      .object({
        kind: route.kind,
        protocols: route.protocols,
        endpoints: route.endpoints,
        required_clients: route.required_clients,
      })
      .strict(),
    authentication: z
      .object({ methods: route.auth_methods, oauth_scopes: z.array(text).nullable() })
      .strict(),
    billing: z
      .object({
        kind: route.billing,
        models: z.array(text),
        subscription_id: text.nullable(),
      })
      .strict(),
    support: route.support,
    third_party_use: route.third_party_use,
    automation: route.automation,
    constraints: route.constraints,
    reviewed_on: z.iso.date(),
    sources: z.array(documentationSourceSchema).min(1),
    model_discovery: modelDiscoverySchema,
    reference_catalog: z
      .object({
        role: z.literal("reference-only"),
        path: text.nullable(),
        status: z.enum(["documented", "unavailable", "not-applicable"]),
        native_models: z.number().int().nonnegative(),
        documented_models: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((connection, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (connection.id !== `${connection.service_id}/${connection.route_id}`)
      fail("Connection identity does not match service and route");
    if (connection.path !== connectionPath(connection.service_id, connection.route_id))
      fail("Connection path does not match service and route");
    if (
      (connection.billing.kind === "subscription") !==
      (connection.billing.subscription_id !== null)
    )
      fail("Only subscription billing can name a subscription");
    if (
      connection.authentication.oauth_scopes !== null &&
      !connection.authentication.methods.includes("oauth")
    )
      fail("OAuth scopes require OAuth authentication");
    const method = connection.model_discovery.method;
    if (method.kind !== "documented") return;
    if (connection.support !== "documented")
      fail("Discovery requires documented connection support");
    const sources = new Set(method.sources.map((source) => source.id));
    for (const step of method.steps) {
      if (step.evidence.some((source) => !sources.has(source))) fail("Missing discovery source");
      if (
        step.kind === "json-rpc" &&
        (connection.execution !== "coding-agent" ||
          !connection.transport.required_clients.includes(step.runtime))
      )
        fail("Runtime discovery requires the connection's coding agent");
      if (step.format === "chatgpt-models" && !connection.authentication.methods.includes("oauth"))
        fail("ChatGPT plan API discovery requires OAuth authentication");
      if (step.format === "openai-models" && !connection.authentication.methods.includes("api-key"))
        fail("OpenAI API discovery requires API-key authentication");
    }
  });
export type Connection = z.infer<typeof connectionSchema>;

export const connectionsSchema = z
  .object({
    schema_version: z.literal(3),
    connections: z.array(connectionSchema),
    research_coverage: z
      .object({
        total: z.number().int().nonnegative(),
        reviewed: z.number().int().nonnegative(),
        limited: z.number().int().nonnegative(),
        unreviewed: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    const ids = catalog.connections.map((connection) => connection.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Duplicate connection identity" });
  });

function connectionPath(service: string, route: string) {
  if ([service, route].some((part) => part === "." || part === ".."))
    throw new Error("Invalid connection path segment");
  return `connections/services/${encodeURIComponent(service)}/routes/${encodeURIComponent(route)}.json`;
}

function discoveryFor(id: string) {
  return modelDiscovery(
    discoveryProfiles.profiles.find((profile) => profile.connection_id === id)?.method ?? {
      kind: "unavailable",
      reason: "no-reviewed-discovery-method",
    },
  );
}

const knownConnections = new Set([
  ...subscriptions.flatMap((subscription) =>
    subscription.integration.routes.map((route) => `${subscription.id}/${route.id}`),
  ),
  ...providerResearch.providers
    .filter((review) => review.direct_api_key === "documented")
    .map((review) => `${review.provider_id}/api-key`),
]);
for (const profile of discoveryProfiles.profiles) {
  if (!knownConnections.has(profile.connection_id))
    throw new Error(`Unknown discovery connection: ${profile.connection_id}`);
}

/** Compose access methods independently of public model lists and account-specific model results. */
export function composeConnections(upstream: Upstream, upstreamSha256: string, registry: Registry) {
  const research = composeProviderResearch(upstream, upstreamSha256);
  const connections: Connection[] = subscriptions.flatMap((subscription) =>
    subscription.integration.routes
      .filter((route) => route.support === "documented")
      .map((route) => {
        const id = `${subscription.id}/${route.id}`;
        const owners = registry.providers.filter((owner) =>
          subscription.products.includes(owner.id),
        );
        const claims = owners.flatMap((owner) =>
          owner.claims
            .filter(
              (claim) => claim.channel === "subscription" && claim.route_ids.includes(route.id),
            )
            .map((claim) => ({ claim, state: owner.state })),
        );
        const documented = claims.filter(
          ({ claim, state }) =>
            state === "current" &&
            claim.status === "available" &&
            claim.request_model_id !== null &&
            claim.plan !== null,
        );
        const hasCatalog = owners.some((owner) =>
          owner.claims.some((claim) => claim.channel === "subscription"),
        );
        return {
          id,
          path: connectionPath(subscription.id, route.id),
          service_id: subscription.id,
          route_id: route.id,
          name: route.name,
          provider_ids: research.providers
            .filter((review) => review.subscription_ids.includes(subscription.id))
            .map((review) => review.provider_id)
            .sort(compare),
          products: route.products,
          execution: route.execution,
          transport: {
            kind: route.kind,
            protocols: route.protocols,
            endpoints: route.endpoints,
            required_clients: route.required_clients,
          },
          authentication: {
            methods: route.auth_methods,
            oauth_scopes:
              discoveryProfiles.profiles.find((profile) => profile.connection_id === id)
                ?.oauth_scopes ?? null,
          },
          billing: {
            kind: route.billing,
            models: [route.billing],
            subscription_id: route.billing === "subscription" ? subscription.id : null,
          },
          support: route.support,
          third_party_use: route.third_party_use,
          automation: route.automation,
          constraints: route.constraints,
          reviewed_on: subscription.integration.reviewed_on,
          sources: subscription.integration.sources.filter((source) =>
            route.evidence.includes(source.id),
          ),
          model_discovery: discoveryFor(id),
          reference_catalog: {
            role: "reference-only",
            path: hasCatalog ? `subscriptions/${encodeURIComponent(subscription.id)}.json` : null,
            status:
              route.billing !== "subscription"
                ? "not-applicable"
                : documented.length
                  ? "documented"
                  : "unavailable",
            native_models: new Set(claims.map(({ claim }) => claim.source_model)).size,
            documented_models: new Set(documented.map(({ claim }) => claim.source_model)).size,
          },
        };
      }),
  );
  for (const review of research.providers) {
    if (
      review.direct_api_key !== "documented" ||
      !(
        review.billing_models.includes("pay-as-you-go") ||
        review.billing_models.includes("byok") ||
        (review.billing_models.includes("credits") &&
          !review.billing_models.includes("subscription"))
      )
    )
      continue;
    if (!review.reviewed_on) throw new Error(`Missing API review date: ${review.provider_id}`);
    const id = `${review.provider_id}/api-key`;
    connections.push({
      id,
      path: connectionPath(review.provider_id, "api-key"),
      service_id: review.provider_id,
      route_id: "api-key",
      name: `${review.provider_id} API key`,
      provider_ids: [review.provider_id],
      products: [],
      execution: "direct-model",
      transport: { kind: "direct-api", protocols: [], endpoints: [], required_clients: [] },
      authentication: { methods: ["api-key"], oauth_scopes: null },
      billing: {
        kind:
          review.billing_models.includes("byok") && review.billing_models.includes("pay-as-you-go")
            ? "unknown"
            : review.billing_models.includes("byok")
              ? "byok"
              : "usage-based",
        models: review.billing_models.filter((model) => model !== "subscription"),
        subscription_id: null,
      },
      support: "documented",
      third_party_use: "unknown",
      automation: "unknown",
      constraints: [review.summary, ...review.limitations],
      reviewed_on: review.reviewed_on,
      sources: review.sources.map((source) => ({
        id: `official-${hash(source.url).slice(0, 16)}`,
        url: source.url,
        sha256: source.sha256,
        capture_kind: source.capture_kind,
      })),
      model_discovery: discoveryFor(id),
      reference_catalog: {
        role: "reference-only",
        path: `providers/${encodeURIComponent(review.provider_id)}.json`,
        status: "documented",
        native_models: Object.keys(upstream.providers[review.provider_id]?.models ?? {}).length,
        documented_models: 0,
      },
    });
  }
  return connectionsSchema.parse({
    schema_version: 3,
    connections: connections.sort((a, b) => compare(a.id, b.id)),
    research_coverage: research.counts,
  });
}
