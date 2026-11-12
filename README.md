# Swarmie Catalog

A deterministic subscription enrichment layer for [models.dev](https://models.dev).
It records public declarations about models, products, plans, access channels, and clients.
Each declaration has source evidence. The catalog does not grant account access.

The project uses public sources, TypeScript, Bun, and static JSON. Synchronization uses
no AI extraction, accounts, subscription credentials, database, or server.

Current integrations cover GitHub Copilot and the bundled OpenAI Codex catalog.
Claude, Gemini, and ChatGPT Chat coverage remains unknown where no qualified adapter exists.
See [coverage and sources](docs/sources.md) for the exact scope.

Use [DEVELOPMENT.md](DEVELOPMENT.md) to install, test, synchronize, and configure GitHub.
See the [documentation index](docs/index.md) for the schema and consumer API.

Source fixtures and derived data retain their original notices. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
