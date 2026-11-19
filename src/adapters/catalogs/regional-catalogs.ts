import { extract as core, coreSourceManifest, type Row } from "./region-plans.ts";
import { extract as extra, sourceManifest as extraSourceManifest } from "./regional-extras.ts";
export function extract(
  subscriptionId: string,
  bodies: Record<string, string>,
  routes: string[],
): Row[] {
  const rows = extraSourceManifest[subscriptionId]
    ? extra(subscriptionId, bodies)
    : core(subscriptionId, bodies);
  if (!routes?.length) throw new Error(`No reviewed subscription route for ${subscriptionId}`);
  return rows.map((row) => {
    const edition = typeof row.conditions?.edition === "string" ? row.conditions.edition : null;
    const tokenPlan = edition === "personal" || edition === "team";
    const capability = row.conditions?.source_capabilities;
    const textModel = typeof capability === "string" && /text generation|文本生成/.test(capability);
    const nonchat =
      (tokenPlan && (!textModel || row.conditions?.source_domain_model_group === true)) ||
      (subscriptionId === "venice-paid-plans" && row.conditions?.model_type !== "text") ||
      (subscriptionId === "abacus" && row.conditions?.model_type !== "text_generation") ||
      subscriptionId === "modelis";
    let selected = nonchat ? [] : [...routes];
    if (subscriptionId === "alibaba" && !nonchat)
      selected = routes.filter((route) =>
        edition === "legacy-coding-plan"
          ? route === "legacy-coding-plan"
          : route === "token-plan-tools",
      );
    if (subscriptionId === "tencent-tokenhub-plans")
      selected = routes.filter((route) =>
        edition === "tencent-coding-plan"
          ? route === "tencent-coding-plan"
          : route === "tokenhub-token-plan",
      );
    const namespaced = tokenPlan || subscriptionId === "alibaba";
    return {
      ...row,
      plans: namespaced ? row.plans.map((plan) => `${edition}:${plan}`) : row.plans,
      conditions: {
        ...row.conditions,
        ...(namespaced ? { source_plan_names: row.plans, edition_plan_namespace: edition } : {}),
        route_ids: selected,
        request_protocol_qualified: selected.length > 0,
        ...(nonchat
          ? {
              route_qualification_limit:
                "Membership is documented; current catalog route only qualifies text requests. Preserve native model without assigning a chat route.",
            }
          : {}),
      },
    };
  });
}

export const sourceManifest = { ...coreSourceManifest, ...extraSourceManifest };
