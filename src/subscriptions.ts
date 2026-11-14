export const subscriptions = [
  { id: "chatgpt", name: "ChatGPT", products: ["openai-codex"] },
  { id: "github-copilot", name: "GitHub Copilot", products: ["github-copilot"] },
] as const;
export type SubscriptionId = (typeof subscriptions)[number]["id"];

/** Resolve the subscription namespace without changing the source product or plan tokens. */
export function subscriptionForProduct(product: string): SubscriptionId {
  for (const definition of subscriptions) {
    if (definition.products.some((item) => item === product)) return definition.id;
  }
  throw new Error(`Unknown subscription product: ${product}`);
}
