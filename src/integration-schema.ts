import { z } from "zod";

const text = z.string().min(1);
const httpsUrl = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Expected an HTTPS URL without credentials");
const documentedUse = z.enum(["supported", "restricted", "unknown"]);
export const integrationRouteSchema = z
  .object({
    id: text,
    name: text,
    kind: z.enum(["direct-api", "cli", "sdk"]),
    execution: z.enum(["direct-model", "coding-agent", "unknown"]),
    billing: z.enum(["subscription", "usage-based", "byok", "unknown"]),
    products: z.array(text).min(1),
    support: z.enum(["documented", "not-supported", "unknown"]),
    auth_methods: z.array(z.enum(["oauth", "account-login", "api-key", "github-token"])),
    required_clients: z.array(text),
    protocols: z.array(text),
    endpoints: z.array(
      z
        .object({
          url: httpsUrl,
          protocols: z.array(text).min(1),
          region: text.optional(),
        })
        .strict(),
    ),
    third_party_use: documentedUse,
    automation: documentedUse,
    constraints: z.array(text).min(1),
    evidence: z.array(text).min(1),
  })
  .strict()
  .superRefine((route, ctx) => {
    if (route.support !== "documented" && route.third_party_use === "supported")
      ctx.addIssue({
        code: "custom",
        message: `Unsupported route cannot grant third-party use: ${route.id}`,
      });
    if (
      route.support === "documented" &&
      route.kind !== "direct-api" &&
      !route.required_clients.length
    )
      ctx.addIssue({ code: "custom", message: `Missing required runtime: ${route.id}` });
    for (const endpoint of route.endpoints) {
      if (endpoint.protocols.some((protocol) => !route.protocols.includes(protocol)))
        ctx.addIssue({ code: "custom", message: `Undeclared endpoint protocol: ${route.id}` });
    }
  });
export const integrationSchema = z
  .object({
    reviewed_on: z.iso.date(),
    sources: z
      .array(
        z
          .object({
            id: text,
            url: httpsUrl,
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            capture_kind: z.enum(["http-body", "web-extract"]),
          })
          .strict(),
      )
      .min(1),
    routes: z.array(integrationRouteSchema).min(1),
  })
  .strict()
  .superRefine((integration, ctx) => {
    const sources = new Set<string>();
    const routes = new Set<string>();
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    for (const source of integration.sources) {
      if (sources.has(source.id)) fail(`Duplicate documentation source: ${source.id}`);
      sources.add(source.id);
    }
    for (const route of integration.routes) {
      if (routes.has(route.id)) fail(`Duplicate integration route: ${route.id}`);
      routes.add(route.id);
      for (const source of route.evidence) {
        if (!sources.has(source)) fail(`Missing route evidence: ${source}`);
      }
    }
  });
export const subscriptionDefinitionSchema = z
  .object({
    id: text,
    name: text,
    products: z.array(text).min(1),
    integration: integrationSchema,
  })
  .strict()
  .superRefine((definition, ctx) => {
    for (const route of definition.integration.routes) {
      for (const product of route.products) {
        if (!definition.products.includes(product))
          ctx.addIssue({ code: "custom", message: `Unknown route product: ${product}` });
      }
    }
  });
export const subscriptionManifestSchema = z
  .object({
    schema_version: z.literal(2),
    subscriptions: z.array(subscriptionDefinitionSchema).min(1),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const subscriptions = new Set<string>();
    const products = new Set<string>();
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    for (const definition of manifest.subscriptions) {
      if (subscriptions.has(definition.id)) fail(`Duplicate subscription: ${definition.id}`);
      subscriptions.add(definition.id);
      for (const product of definition.products) {
        if (products.has(product)) fail(`Duplicate product namespace: ${product}`);
        products.add(product);
      }
    }
  });
export type SubscriptionDefinition = z.infer<typeof subscriptionDefinitionSchema>;
export type SubscriptionManifest = z.infer<typeof subscriptionManifestSchema>;
