# Sources, coverage, and provider extension

The current adapters use public official sources. All extraction is deterministic.
The generated `dist/coverage.json` reports actual plan tokens and unresolved identities
for the current catalog. The sync report lists failed providers and unresolved names.

## Provider coverage

| Product | Source and coverage | Limits |
| --- | --- | --- |
| GitHub Copilot | Official YAML plan and client tables | Missing cells remain unknown. Product and client flags are combined. Account policy and quota remain outside the catalog. |
| OpenAI Codex | Official bundled JSON, exact plan tokens, CLI surface, minimum version | Plan declarations are client metadata. Hidden models remain unknown. This is not a live account catalog. |
| ChatGPT Chat | Unknown | Codex support does not establish ChatGPT Chat support. |
| Claude and Claude Code | Unknown | No qualified structured model-to-plan extractor is implemented. A CLI default is not a complete plan mapping. |
| Gemini and Gemini CLI | Unknown | Client model categories and dynamic access flags do not establish plan membership. |

### GitHub Copilot

The adapter reads
[model-supported-plans.yml](https://github.com/github/docs/blob/main/data/tables/copilot/model-supported-plans.yml)
and [model-supported-clients.yml](https://github.com/github/docs/blob/main/data/tables/copilot/model-supported-clients.yml).
The loader resolves each file to its latest path-specific commit before fetching it.

Known plan columns are Free, Pro, Pro+, Max, Business, and Enterprise.
The current source omits Free. Its absence produces unknown values, except where an
explicit client exclusion establishes that a surface is unavailable.
Known client tokens cover GitHub.com, CLI, VS Code, Visual Studio, Eclipse, Xcode,
and JetBrains. A missing client row does not erase the product-level plan declaration.
It produces unknown surface-specific availability.

The adapter rejects unknown columns, duplicate YAML keys, duplicate model rows, wrong
boolean types, empty tables, and unmatched client-only models. A new source column
needs a reviewed schema update. It does not silently disappear.

The initial live run could not resolve `Claude Opus 4.8 (fast mode) (preview)` to a
canonical model. It remains unresolved. It is not silently treated as the base variant.

### OpenAI Codex

The adapter reads
[codex-rs/models-manager/models.json](https://github.com/openai/codex/blob/main/codex-rs/models-manager/models.json).
It validates slugs, visibility, API support, minimum version, and plan arrays.
It preserves upstream plan tokens. It does not label internal tokens as marketed plans.
An empty or absent plan array produces an unspecified `unknown` subscription record.
A malformed array fails the provider.

The bundled JSON declares `available_in_plans`, but the public Rust `ModelInfo` type
and local authentication filter do not interpret that field as an account grant.
The client can obtain a separate remote catalog. The adapter's positive status means
an explicit bundled declaration for a listed model. Hidden models remain unknown.
See the official [model contract and filter](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/openai_models.rs)
and [workspace restrictions](https://learn.chatgpt.com/docs/enterprise/workspace-model-availability).

A bounded source-history sample showed 10 file changes over about 45 days.
This is an observation, not a publication schedule. The source commit date remains
visible even when a source has not changed for several checks.
The initial run left `codex-auto-review` unresolved. No identity is invented for it.

### Claude and Gemini gaps

The inspected [Claude Code repository](https://github.com/anthropics/claude-code) contains
extensions and supporting material, but no public core subscription model resolver.
The [model configuration guide](https://code.claude.com/docs/en/model-config) contains
plan-dependent defaults, aliases, and organization limits. Those facts do not establish
a complete plan-to-model grant list. A future extractor must preserve exact qualifiers.

Gemini CLI publishes a
[model registry](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/config/defaultModelConfigs.ts)
and [model selection logic](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/modelConfigService.ts).
Its `tier` values classify models. They are not subscription plans. Runtime preview,
Pro access, and experiment flags affect selection. The public
[plans page](https://geminicli.com/plans/) does not provide the missing complete mapping.
No CLI constant is promoted into a subscription grant.

## Add a provider

1. Find a public source with explicit scope and availability evidence.
2. Check its source contract and reuse terms.
3. Add a provider module under `src/adapters/`.
4. Implement `load` with public immutable snapshots.
5. Implement `parse` without network or file effects.
6. Validate every field that affects a claim.
7. Add the exact identity namespace to `src/reconcile.ts`.
8. Register the adapter in `src/cli.ts`.
9. Add fixtures with source URLs, revisions, digests, and notices.
10. Test exclusions, missing information, source drift, failures, and ordering.
11. Run `bun run check` and a live synchronization.
12. Review the coverage report and source evidence.

Prefer JSON or YAML over documentation parsing. If HTML or Markdown is required,
validate table structure and preserve qualifications. Do not infer plan access from a
model list. Do not add manually maintained availability rows to fill a source gap.
