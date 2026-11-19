import { extract as additional, sourceUrls } from "./commercial-plans.ts";
import type { ExtractedRow, JSON as JsonValue } from "./plan-tables.ts";
import { extract as original } from "./plan-tables.ts";

const CHAT = "openai-chat-completions";
const MESSAGES = "anthropic-messages";

/** Apply reviewed route and protocol scope to source model discovery. */
export function extract(
  parser: string,
  bodies: Record<string, string>,
  routes: string[],
): ExtractedRow[] {
  const definition = { parser, routes };
  const raw =
    definition.parser in sourceUrls
      ? additional(definition.parser, bodies)
      : original(definition.parser, bodies);
  return raw.map((row) => {
    const conditions = row.conditions ?? {};
    let qualified = true;
    let protocols = [CHAT];
    let reason = "documented-chat-model-route";
    switch (definition.parser) {
      case "aigrow-subscription":
        protocols = [CHAT, MESSAGES];
        break;
      case "huawei-maas":
        reason = "native-model-ids-qualified-in-opencode-openai-parameter-table";
        break;
      case "nan":
        qualified =
          typeof conditions.source_context === "string" &&
          /^\d+(?:\.\d+)?[KM]$/.test(conditions.source_context);
        reason = qualified
          ? "text-generation-context-in-official-model-table"
          : "non-chat-model-needs-separate-transport-contract";
        break;
      case "uplinkswitch-subscription":
        qualified =
          conditions.model_type === "chat" &&
          Array.isArray(conditions.native_endpoints) &&
          conditions.native_endpoints.includes("/v1/chat/completions");
        reason = qualified
          ? "native-catalog-explicit-chat-endpoint"
          : "catalog-model-has-no-qualified-chat-endpoint";
        break;
      case "xiaomi-token-plan":
      case "xiaomi-mimo-token-plan":
        qualified = conditions.model_kind === "text-chat";
        protocols = definition.parser === "xiaomi-mimo-token-plan" ? [CHAT, MESSAGES] : [CHAT];
        reason = qualified
          ? "model-listed-in-token-plan-chat-conversion-table"
          : "audio-or-retired-model-has-no-qualified-current-chat-route";
        break;
      case "neuralwatt":
        qualified =
          Array.isArray(conditions.output_modalities) &&
          conditions.output_modalities.includes("text");
        reason = qualified
          ? "text-output-public-model-catalog"
          : "decision-output-model-has-no-qualified-chat-route";
        break;
      case "zai-coding-plan":
      case "glm-coding-plan-cn":
        protocols = [CHAT, MESSAGES];
        reason =
          "model-reference-chat-id-and-official-claude-client-support; responses-not-qualified-per-model";
        break;
      case "standardcompute-plans":
        reason = "openai-model-catalog; anthropic-per-model-contract-not-qualified";
        break;
    }
    const routes = qualified ? definition.routes : [];
    const routeProtocols: Record<string, JsonValue> = {};
    for (const route of routes)
      routeProtocols[route] = route === "clinepass-cline-cli" ? [] : protocols;
    const api = row.api
      ? Object.fromEntries(
          Object.entries(row.api).filter(([protocol]) => protocols.includes(protocol)),
        )
      : undefined;
    return {
      ...row,
      status: qualified || row.status === "unavailable" ? row.status : "unknown",
      ...(api ? { api } : {}),
      conditions: {
        ...conditions,
        route_ids: routes,
        route_protocols: routeProtocols,
        route_qualification: reason,
        general_api_permission:
          definition.parser === "huawei-maas" ||
          definition.parser.startsWith("xiaomi") ||
          definition.parser === "scnet-token-plan" ||
          definition.parser.includes("coding-plan")
            ? "restricted-to-officially-supported-tools"
            : "governed-by-integration-route-policy",
      },
    };
  });
}
