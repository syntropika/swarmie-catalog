# Swarmie Catalog

A static connection catalog and model metadata layer built on [models.dev](https://models.dev).
It describes services, authentication, subscription or API billing, direct model access
and coding-agent execution. Clients discover their account's models through the selected
connection. A public model list does not establish account access.

OpenAI connections distinguish direct ChatGPT plan OAuth, ChatGPT through Codex,
Codex with a separately billed API key and direct OpenAI API-key access. Each connection
requires client model discovery. Reviewed HTTP and runtime procedures have explicit
response formats and sources. Missing procedures remain unavailable. Clients must not
fall back to static model lists.

The catalog preserves models.dev provider metadata and public subscription research.
Reference models retain native identities, plan vectors and source evidence. Clients
use those records for metadata and published conditions. They select models from their
connection's discovery results. See the [connection contract](docs/integrations.md)
and [client workflow](docs/client-model-discovery.md).

The project uses public sources, TypeScript, Bun and static JSON. Synchronization uses
no AI extraction, accounts, subscription credentials, database or server.
Static paths group connections by service, provider, execution and funding method.
See [coverage and sources](docs/sources.md) for the research scope.

Use [DEVELOPMENT.md](DEVELOPMENT.md) to install, test, synchronize and configure GitHub.
See the [documentation index](docs/index.md) for the schema and consumer API.
Source fixtures and derived data retain their original notices. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
