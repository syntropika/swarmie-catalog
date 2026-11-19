export {
  composeProvider,
  composeSubscription,
  createCatalogComposer,
  ModelCatalogUnavailableError,
} from "./compose.ts";
export type { Connection } from "./connections.ts";
export { composeConnections, connectionSchema, connectionsSchema } from "./connections.ts";
export type { DiscoveredModel, ModelDiscovery } from "./discovery.ts";
export {
  ModelDiscoveryError,
  modelDiscoverySchema,
  readModelPage,
  resolveDiscoveredModels,
} from "./discovery.ts";
export { validateRegistry } from "./engine.ts";
export type { SubscriptionDefinition, SubscriptionManifest } from "./integration-schema.ts";
export {
  integrationSchema,
  subscriptionManifestSchema,
} from "./integration-schema.ts";
export { composeModelResearch, modelResearch, modelResearchSchema } from "./model-research.ts";
export type { ProviderReview } from "./provider-research.ts";
export {
  composeProviderResearch,
  providerResearch,
  providerResearchSchema,
  providerReview,
} from "./provider-research.ts";
export type { Query } from "./query.ts";
export { query } from "./query.ts";
export type {
  Availability,
  Claim,
  ComposedProvider,
  ComposedSubscription,
  Registry,
  SubscriptionOffer,
  Upstream,
} from "./schema.ts";
export {
  composedProviderSchema,
  composedSubscriptionSchema,
  registrySchema,
  upstreamSchema,
} from "./schema.ts";
export { subscriptionManifest, subscriptions } from "./subscriptions.ts";
