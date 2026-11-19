import { z } from "zod";
import { type ModelSourceDefinition, modelSources } from "../model-sources.ts";
import { catalogParsers } from "./catalogs/parsers.ts";
import type { CatalogParser } from "./catalogs/types.ts";

import type { Adapter } from "./types.ts";

export function publicCatalogAdapter(
  definition: ModelSourceDefinition,
  parser: CatalogParser,
): Adapter {
  return {
    id: definition.product,
    async load(loader) {
      return Promise.all(
        definition.sources.map((source) =>
          loader({ kind: "http", id: `${definition.product}-${source.id}`, url: source.url }),
        ),
      );
    },
    parse(snapshots) {
      const bodies = Object.fromEntries(
        snapshots.map((snapshot) => [snapshot.source.url, snapshot.body]),
      );
      const rows = parser(bodies, definition.routes);
      if (!rows.length) throw new Error(`Empty subscription catalog: ${definition.product}`);
      return rows.flatMap((row) => {
        if (!row.id) throw new Error("Missing native model identity");
        if (!row.plans.length && row.status !== "unknown")
          throw new Error("A named subscription plan is required for a grant");
        const scopedRoutes = row.conditions?.route_ids;
        if (
          scopedRoutes !== undefined &&
          (!Array.isArray(scopedRoutes) ||
            scopedRoutes.some((id) => typeof id !== "string" || !definition.routes.includes(id)))
        )
          throw new Error("Model references an unqualified route");
        const routes =
          scopedRoutes === undefined ? definition.routes : z.array(z.string()).parse(scopedRoutes);
        const routePlanAccess =
          row.conditions?.route_plan_access === undefined
            ? null
            : z.record(z.string(), z.array(z.string())).parse(row.conditions.route_plan_access);
        if (
          routePlanAccess &&
          Object.entries(routePlanAccess).some(
            ([route, plans]) =>
              !routes.includes(route) || plans.some((plan) => !row.plans.includes(plan)),
          )
        )
          throw new Error("Invalid route-specific plan scope");
        const { route_ids: _routeIds, ...conditions } = row.conditions ?? {};
        const evidence = row.evidence.map((item) => {
          const source = snapshots.find((snapshot) => snapshot.source.url === item.url);
          if (!source) throw new Error(`Missing model scope source: ${item.url}`);
          return { source: source.source.id, locator: item.locator };
        });
        return (row.plans.length ? row.plans : [null]).map((plan) => ({
          product: definition.product,
          provider: definition.offering_provider,
          source_model: row.id,
          request_model_id: row.id,
          offering_provider: definition.offering_provider,
          route_ids:
            plan === null
              ? []
              : routes.filter(
                  (route) => !routePlanAccess || routePlanAccess[route]?.includes(plan),
                ),
          request_api: row.api ?? {},
          conditions,
          ...(row.canonical_hint ? { canonical_hint: row.canonical_hint } : {}),
          channel: "subscription" as const,
          plan,
          surface: null,
          variant: null,
          minimum_client_version: null,
          status: row.status,
          reason: "official-subscription-model-source",
          evidence,
        }));
      });
    },
  };
}

export const publicCatalogAdapters: Adapter[] = modelSources.products.map((definition) => {
  const parser = catalogParsers[definition.parser];
  if (!parser) throw new Error(`Unknown catalog parser: ${definition.parser}`);
  return publicCatalogAdapter(definition, parser);
});
