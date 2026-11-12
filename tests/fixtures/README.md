# Source fixtures

`copilot-plans.json`, `copilot-clients.json`, and `codex-models.json` contain exact
HTTP source bodies inside a `source` and `body` wrapper. Each `source` identifies an
immutable official URL, revision, content digest, and source commit time.
These files support offline parser and reconciliation tests. Prompt strings inside
Codex data are opaque source material and are never executed.

`upstream.json` contains only identity fields from the public models.dev catalog:
canonical IDs, names, offering IDs, and canonical links for relevant providers.
It is a test projection, not a replacement model database or a full upstream archive.
The live engine consumes the complete official public catalog.

Fixture mutations in tests are synthetic inputs. They must never become published
availability data. Refresh captures only after inspecting source changes. Keep source
notices and verify digests. See [third-party notices](../../THIRD_PARTY_NOTICES.md).
