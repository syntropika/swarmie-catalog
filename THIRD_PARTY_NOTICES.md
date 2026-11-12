# Third-party notices

The test fixtures contain source material from the projects below.
The source captures are stored as JSON wrappers with immutable URLs, revisions,
SHA-256 digests, and the original source body. The wrappers do not change those bodies.
The small upstream identity fixture is a projection of public catalog fields.
Generated availability records are transformations of these sources.
No source author endorses this project.

| Material | Author and source | Terms and local copy |
| --- | --- | --- |
| Codex bundled model catalog | OpenAI, [openai/codex](https://github.com/openai/codex) | [Apache License 2.0](tests/fixtures/licenses/codex-license.txt), [original notice](tests/fixtures/licenses/codex-notice.txt) |
| Copilot plan and client tables | GitHub and contributors, [github/docs](https://github.com/github/docs) | [CC BY 4.0](tests/fixtures/licenses/github-docs-license.txt) |
| Canonical identities and offering links | models.dev contributors, [anomalyco/models.dev](https://github.com/anomalyco/models.dev) | [MIT License](tests/fixtures/licenses/models-dev-license.txt) |

The canonical-ID punctuation rule follows the published models.dev Copilot adapter.
The implementation records availability separately and does not reproduce the upstream
model database. Dependencies retain their own licenses in their distributions.
