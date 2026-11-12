import { describe, expect, test } from "bun:test";
import { codex } from "../src/adapters/codex.ts";
import { copilot } from "../src/adapters/copilot.ts";
import { fixtureLoader, snapshot } from "./helpers.ts";

const codexBody = (extra: object = {}) =>
  JSON.stringify({
    models: [
      {
        slug: "gpt-6-sol",
        visibility: "list",
        supported_in_api: true,
        minimal_client_version: "0.100.0",
        available_in_plans: ["plus"],
        ...extra,
      },
    ],
  });
const copilotSources = async (plans: string, clients = "- name: GPT-6 Sol\n  cli: true\n") => [
  await snapshot("copilot-plans", plans),
  await snapshot("copilot-clients", clients),
];
describe("Copilot official YAML", () => {
  test("real fixture exposes explicit exclusions and missing Free as unknown", async () => {
    const claims = copilot.parse(await copilot.load(fixtureLoader));
    expect(claims).toHaveLength(1440);
    expect(claims.some((claim) => claim.status === "unavailable")).toBe(true);
    expect(
      claims
        .filter((claim) => claim.plan === "free")
        .every((claim) => claim.status !== "available"),
    ).toBe(true);
    expect(
      claims.find(
        (claim) =>
          claim.source_model === "GPT-6.1 Sol" &&
          claim.surface === "cli" &&
          claim.plan === "pro_plus",
      )?.status,
    ).toBe("unknown");
  });
  test("intersects plan support with client exclusions without inventing membership", async () => {
    const claims = copilot.parse(
      await copilotSources(
        "- name: GPT-6 Sol\n  pro: true\n  business: false\n",
        "- name: GPT-6 Sol\n  cli: false\n",
      ),
    );
    expect(claims.find((claim) => claim.plan === "pro" && claim.surface === null)?.status).toBe(
      "available",
    );
    expect(claims.find((claim) => claim.plan === "pro" && claim.surface === "cli")?.status).toBe(
      "unavailable",
    );
    expect(claims.find((claim) => claim.plan === "pro" && claim.surface === "vscode")?.status).toBe(
      "unknown",
    );
  });
  test("rejects empty, malformed, duplicate rows, duplicate keys, new columns, and wrong types", async () => {
    for (const body of [
      "[]",
      "- name: GPT-6 Sol\n  pro: yes",
      "- name: GPT-6 Sol\n  platinum: true",
      "- name: GPT-6 Sol\n  pro: true\n  pro: false",
      "- name: GPT-6 Sol\n  pro: true\n- name: GPT-6 Sol\n  pro: true",
      "- name: GPT-6 Sol",
    ]) {
      const awaitValue = await copilotSources(body);
      expect(() => copilot.parse(awaitValue)).toThrow();
    }
  });
  test("rejects unmatched client rows", async () => {
    const inputs = await copilotSources(
      "- name: GPT-6 Sol\n  pro: true",
      "- name: Other\n  cli: true",
    );
    expect(() => copilot.parse(inputs)).toThrow();
  });
});
describe("Codex official JSON", () => {
  test("preserves raw plan tokens and keeps API account access unknown", async () => {
    const claims = codex.parse(await codex.load(fixtureLoader));
    expect(claims.some((claim) => claim.plan === "enterprise_cbp_trial")).toBe(true);
    expect(
      claims
        .filter((claim) => claim.channel === "api")
        .every((claim) => claim.status === "unknown"),
    ).toBe(true);
    expect(claims.every((claim) => claim.minimum_client_version !== null)).toBe(true);
  });
  test("hidden models and absent or empty plan evidence stay unknown", async () => {
    for (const extra of [
      { visibility: "hide" },
      { available_in_plans: [] },
      { available_in_plans: undefined },
    ]) {
      const claims = codex.parse([await snapshot("codex-models", codexBody(extra))]);
      expect(
        claims
          .filter((claim) => claim.channel === "subscription")
          .every((claim) => claim.status === "unknown"),
      ).toBe(true);
    }
  });
  test("API exclusion does not remove subscription declarations", async () => {
    const claims = codex.parse([
      await snapshot("codex-models", codexBody({ supported_in_api: false })),
    ]);
    expect(claims.find((claim) => claim.channel === "api")?.status).toBe("unavailable");
    expect(claims.find((claim) => claim.channel === "subscription")?.status).toBe("available");
  });
  test("invalid plan shapes and duplicate plan tokens fail visibly", async () => {
    for (const plans of [null, "plus", ["plus", "plus"], [false]]) {
      const sources = [await snapshot("codex-models", codexBody({ available_in_plans: plans }))];
      expect(() => codex.parse(sources)).toThrow();
    }
  });
});
