import type { Availability, Claim, Registry } from "./schema.ts";

export interface Query {
  product?: string;
  plan?: string;
  surface?: string;
  model?: string;
  channel?: "subscription" | "api";
  status?: Availability;
  includeStale?: boolean;
  includeUnresolved?: boolean;
}
/** Return source declarations. An available record does not grant account authority. */
export function query(registry: Registry, filter: Query = {}): Claim[] {
  return registry.providers
    .filter((provider) => filter.includeStale || provider.state === "current")
    .flatMap((provider) => provider.claims)
    .filter(
      (claim) =>
        (filter.includeUnresolved || claim.model_id !== null) &&
        (filter.product === undefined || claim.product === filter.product) &&
        (filter.plan === undefined || claim.plan === filter.plan) &&
        (filter.surface === undefined || claim.surface === filter.surface) &&
        (filter.model === undefined || claim.model_id === filter.model) &&
        (filter.channel === undefined || claim.channel === filter.channel) &&
        (filter.status === undefined || claim.status === filter.status),
    );
}
