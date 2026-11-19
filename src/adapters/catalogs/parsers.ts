import { openCodeGo, vercelTokenPass } from "./aggregators.ts";
import { extract as creditGateways } from "./credit-gateways.ts";
import { extract as creditPlans } from "./credit-plans.ts";
import { extract as gatewayExtras } from "./gateway-extras.ts";
import { extract as gatewayPlans } from "./gateway-plans.ts";
import { extract as regionPlans } from "./regional-catalogs.ts";
import { extract as planTables } from "./table-catalogs.ts";
import type { CatalogParser } from "./types.ts";

function group(
  extract: (
    id: string,
    bodies: Record<string, string>,
    routes: string[],
  ) => ReturnType<CatalogParser>,
  ids: string[],
): Record<string, CatalogParser> {
  return Object.fromEntries(
    ids.map((id) => [
      id,
      (bodies: Record<string, string>, routes: string[]) => extract(id, bodies, routes),
    ]),
  );
}
export const catalogParsers: Record<string, CatalogParser> = {
  "opencode-go": openCodeGo,
  "vercel-token-pass": vercelTokenPass,
  ...group(regionPlans, [
    "xpersona-subscription",
    "trustedtokens-subscription",
    "regolo-subscription",
    "jiekou",
    "fireworks-ai",
    "ollama-cloud-subscription",
    "modelis",
    "alibaba",
    "alibaba-cn-coding-plan",
    "alibaba-coding-plan-cn",
    "alibaba-coding-plan-intl",
    "alibaba-token-plan-intl",
    "alibaba-token-plan-cn",
    "tencent-coding-plan",
    "tencent-token-plan",
    "tencent-tokenhub-plans",
    "kuae-coding-plan",
    "nano-gpt-pro",
    "huggingface-pro-inference-credits",
    "venice-paid-plans",
    "sparrowcodes",
    "poe-subscription",
    "abacus",
  ]),
  ...group(gatewayExtras, [
    "inferall-subscription",
    "inference",
    "llmgateway-devpass",
    "commandcode-plans",
    "oathbreaker",
    "subconscious",
    "qiniu-ai-subscription",
  ]),
  ...group(creditGateways, [
    "augure-subscription",
    "io-net",
    "synthetic-subscription",
    "volcengine",
    "kimi",
    "rayline",
    "empiriolabs-subscription",
    "volcengine-ark-coding-plan",
  ]),
  ...group(creditPlans, [
    "kenari-plans",
    "minimax-m-plan",
    "minimax-m-plan-cn",
    "moneo-subscription",
    "unbiased",
    "berget",
    "abliteration-ai-monthly-plans",
    "frogbot-subscription",
    "sakana-subscription",
    "zeldoc",
    "sarvam-credit-plans",
  ]),
  ...group(gatewayPlans, [
    "kilo-subscription",
    "zenifra-ai-plans",
    "agnes",
    "morph-plans",
    "sambanova",
    "stepfun-step-plan",
    "stepfun-step-plan-cn",
    "stepfun-ai-subscription",
    "stepfun-step-plan-global",
    "cerebras-code",
  ]),
  ...group(planTables, [
    "aigrow-subscription",
    "huawei-maas",
    "nan",
    "scnet-token-plan",
    "uplinkswitch-subscription",
    "xiaomi-token-plan",
    "xiaomi-mimo-token-plan",
  ]),
  ...group(planTables, [
    "hyper-subscription",
    "standardcompute-plans",
    "neuralwatt",
    "cline-pass",
    "zai-coding-plan",
    "glm-coding-plan-cn",
  ]),
};
