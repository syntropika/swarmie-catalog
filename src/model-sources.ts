import { z } from "zod";
import data from "../data/model-sources.json" with { type: "json" };
import { catalogParsers } from "./adapters/catalogs/parsers.ts";
import { subscriptions } from "./subscriptions.ts";

const text = z.string().min(1);
export const modelSourcesSchema = z
  .object({
    schema_version: z.literal(1),
    products: z.array(
      z
        .object({
          product: text,
          offering_provider: text,
          routes: z.array(text),
          parser: text,
          sources: z.array(z.object({ id: text, url: z.url() }).strict()).min(1),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const products = new Set<string>();
    for (const definition of manifest.products) {
      const owner = subscriptions.find((item) => item.products.includes(definition.product));
      if (!owner)
        ctx.addIssue({
          code: "custom",
          message: `Missing model source owner: ${definition.product}`,
        });
      for (const id of definition.routes) {
        const route = owner?.integration.routes.find(
          (route) =>
            route.id === id &&
            route.products.includes(definition.product) &&
            route.billing === "subscription",
        );
        if (!route || route.support !== "documented")
          ctx.addIssue({ code: "custom", message: `Unqualified source route: ${id}` });
      }
      if (!catalogParsers[definition.parser])
        ctx.addIssue({ code: "custom", message: `Unknown source parser: ${definition.parser}` });
      for (const source of definition.sources) {
        const url = new URL(source.url);
        if (url.protocol !== "https:" || url.username || url.password)
          ctx.addIssue({ code: "custom", message: "Expected a public HTTPS source" });
      }
      if (products.has(definition.product))
        ctx.addIssue({
          code: "custom",
          message: `Duplicate source product: ${definition.product}`,
        });
      products.add(definition.product);
      if (new Set(definition.sources.map((s) => s.id)).size !== definition.sources.length)
        ctx.addIssue({
          code: "custom",
          message: `Duplicate product source: ${definition.product}`,
        });
    }
  });
export const modelSources = modelSourcesSchema.parse(data);
export type ModelSourceDefinition = (typeof modelSources.products)[number];
