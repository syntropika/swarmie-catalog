# Development

Run commands from the repository root. Use Bun 1.3.10, as set in `.bun-version`
and `package.json`. Dependencies are pinned in `bun.lock`.

```sh
bun install --frozen-lockfile
bun run check
bun run sync
bun run build
```

`check` runs TypeScript, Biome, offline tests, and catalog validation.
Set `CATALOG_TEST_ARTIFACT_DIR` to select an external directory for CLI test artifacts.
`sync` fetches public sources. It writes `data/catalog.json` and operational evidence
under `.artifacts/`. `build` writes static distribution files to `dist/`.
The build fetches models.dev once and joins its provider models with the enrichment layer.
Use `bun run build --upstream tests/fixtures/upstream.json` for an offline build.
The build owns and replaces a marked `dist/` directory. It refuses an unmarked directory.
No command runs an AI service.

Use a separate output for an offline synchronization:

```sh
bun run sync --fixtures tests/fixtures \
  --output .artifacts/reports/replay/catalog.json \
  --report-dir .artifacts/reports/replay
```

The fixtures contain exact source captures and a small upstream identity projection.
They are test inputs. They must not replace a live update without source review.
Use `--upstream FILE` to supply an archived upstream catalog explicitly.
A failed network request never selects a fixture automatically.

Regenerate the JSON schema after a contract change:

```sh
bun src/cli.ts schema
bun run check
```

## Repository layout

| Path | Owner |
| --- | --- |
| `src/adapters/` | Provider loading and extraction |
| `src/fetch.ts` | Public retrieval, limits, and immutable GitHub snapshots |
| `src/reconcile.ts` | Exact model identity and explicit aliases |
| `src/engine.ts` | Validation, conflict handling, retention, and reports |
| `src/query.ts` | Scoped declaration queries |
| `src/compose.ts` | Provider metadata composition and plan grouping |
| `src/index.ts` | Public consumer exports |
| `src/cli.ts` | Files and static distribution |
| `src/publish.ts` | Automation branch and PR updates |
| `data/` | Availability output and explicit identity aliases |
| `schemas/` | Generated JSON schema |
| `tests/fixtures/` | Reproducible provider captures and identity fixtures |
| `.github/workflows/` | Validation, synchronization, and Pages deployment |

## GitHub setup

Create the remote repository when publication is authorized. Keep its intended visibility.
Create the initial reviewed commit on `main`. Push the project only when authorized.
This checkout does not create a remote, stage files, or make an initial commit.

Enable GitHub Actions in the repository. Permit Actions to create pull requests in
Settings, Actions, General. The workflow uses the built-in `GITHUB_TOKEN`.
It needs no personal token, provider key, or paid API. Organization policy can restrict this option.

The synchronization workflow runs every six hours. It also supports manual dispatch.
It validates code and data before it updates one PR on `feat/catalog-sync`.
It can submit valid provider changes when another provider fails. It then reports failure
for the run. It never merges the PR. Read the report before a manual merge.

The publisher writes only `data/catalog.json`. It starts the tree from the default
branch. It appends a commit to the automation branch. When needed, the commit has the
previous automation tip and the current default tip as parents. Reference updates use
`force: false`. It does not rewrite history. It refuses a detected default-branch race.
A no-change run creates no PR. An obsolete open PR is closed if the result matches the base.

The PR validation workflow has read-only repository permissions. The synchronization
job also runs all checks before publication. GitHub can require approval before it runs
PR workflows created by the built-in token. See the official
[workflow trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
Do not assume that a bot PR has completed its independent checks until they appear.

For Pages, select GitHub Actions as the Pages build source. Set the repository variable
`ENABLE_PAGES` to `true` to enable deployment. Without that opt-in, the workflow builds
and uploads the static artifact but does not deploy a site. The Pages workflow builds
reviewed subscription data from `main` with the latest upstream metadata. It also rebuilds
every six hours. Only its deployment job has `pages: write` and `id-token: write`.
All external actions are pinned to full commit IDs. Pages availability and access depend
on repository and account settings. The static `dist/` output also works with other static hosting.

GitHub-hosted execution and Pages deployment must be verified after the remote exists.
Local mock tests do not qualify GitHub account permissions or a deployed URL.
