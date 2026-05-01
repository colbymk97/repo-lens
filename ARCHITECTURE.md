# Yoink Architecture

## System Summary

Yoink is a VS Code extension that indexes remote GitHub repositories into a
local SQLite database, then exposes that indexed content to GitHub Copilot
through built-in `vscode.lm` tools.

The core loop is:

1. Resolve and fetch repository content from GitHub
2. Filter and chunk files by file type
3. Embed and store those chunks locally
4. Answer Copilot tool calls with hybrid retrieval or deterministic file views

At query time, Yoink is local-first: chunks, embeddings, FTS search, and
ranking all run against the local database after indexing completes.

## Top-Level Modules

| Path | Responsibility |
|---|---|
| `src/extension.ts` | Composition root. Constructs services, wires dependencies, and owns disposables. |
| `src/config/` | Config schema, `ConfigManager`, workspace import/export, repo type presets, VS Code setting keys. |
| `src/sources/` | Data source lifecycle, GitHub fetch/resolve/browse helpers, delta sync, scheduled sync. |
| `src/ingestion/` | Fetch-to-chunk-to-embed pipeline, file filtering, parser registry, progress tracking. |
| `src/storage/` | SQLite schema and stores for chunks, embeddings, sync history, and indexing runs. |
| `src/embedding/` | Embedding provider interface, provider registry, embedding management and rebuild flows. |
| `src/retrieval/` | Hybrid retrieval over vector similarity, FTS, and path relevance. |
| `src/tools/` | Tool metadata, tool registration, handlers, search payload shaping, file tree building. |
| `src/ui/` | Sidebar providers, tree items, add-repository wizard, command registrations. |
| `src/agents/` | Installs bundled Copilot agent markdown files into the workspace. |
| `src/auth/` | GitHub authentication and token access. |
| `src/util/` | Logging and shared helpers. |

## Runtime Wiring

`src/extension.ts` is the only composition root. Activation currently wires:

- config: `ConfigManager`
- auth and GitHub access: `GitHubAuth`, `GitHubFetcher`, `GitHubResolver`, `RepoBrowser`
- storage: `openDatabase()`, `ChunkStore`, `EmbeddingStore`, `SyncStore`, `IndexingRunStore`
- ingestion: `DeltaSync`, `ParserRegistry`, `ProgressTracker`, `IngestionPipeline`
- embeddings: `EmbeddingProviderRegistry`, `EmbeddingManager`
- orchestration: `DataSourceManager`, `SyncScheduler`
- retrieval and tools: `Retriever`, `ToolHandler`, `ToolManager`
- UI and workspace integration: sidebar providers, `AddRepoWizard`, command registration, `WorkspaceConfigManager`, `AgentInstaller`

Nothing is a module-level singleton by design. Instances are created in
`activate()` and passed explicitly to the subsystems that need them.

## Configuration Model

Yoink uses two configuration layers:

- `yoink.json` in the extension's global storage directory stores user data:
  repositories, sync state, include/exclude patterns, and repository metadata.
- VS Code settings (`yoink.*`) store operational settings such as embedding
  provider selection, API base URL, search `topK`, and log level.

Each data source represents one indexed GitHub repository and includes:

- repository identity: `owner`, `repo`, `branch`
- indexing scope: include and exclude glob patterns
- sync behavior: `manual`, `onStartup`, or `daily`
- sync state: last synced commit SHA, timestamps, and status

`REPO_TYPE_PRESETS` in `src/config/repoTypePresets.ts` provides curated default
include patterns for common use cases like documentation, source code, Actions
libraries, CI/CD workflows, and OpenAPI specs.

## Ingestion Pipeline

The write path is orchestrated by `src/ingestion/pipeline.ts`:

```text
GitHub Trees API / Compare API
  -> file filtering
  -> content fetch
  -> chunking
  -> embedding
  -> SQLite persistence
```

At a higher level:

1. `DataSourceManager` queues a sync or initial index.
2. `IngestionPipeline` chooses the fetch strategy:
   - full index via repository tree + content fetch
   - delta sync via GitHub compare results when `lastSyncCommitSha` is known
3. Matching files are chunked with file-type-aware routing.
4. Chunk text is embedded through the configured provider.
5. Chunks, embeddings, and FTS rows are written to SQLite.
6. Sync history and indexing-run progress are recorded.
7. Data source status moves through `queued -> indexing -> ready | error`.

`ProgressTracker` holds live in-memory progress that drives sidebar updates
during active indexing runs.

## Chunking Model

Chunking is chosen per file, not per repository. The routing table lives in
`src/ingestion/chunker.ts`.

| File pattern | Strategy |
|---|---|
| `*.md`, `*.mdx` | `markdown-heading` |
| `.github/workflows/*.{yml,yaml}` | `file-level` |
| `action.yml`, `action.yaml` | `file-level` |
| Supported source languages | `ast-based` |
| Everything else | `token-split` |

Current AST chunking supports TypeScript, TSX, JavaScript, JSX, Python, Go,
Java, C#, Rust, and Ruby through Tree-sitter grammars loaded by
`ParserRegistry`.

Important behavior:

- markdown splits on headings, with oversized sections falling back to token windows
- workflow and action YAML are treated as whole-file semantic units unless they exceed model input limits
- AST-based chunks emit top-level functions, methods, and classes
- method chunks are prefixed with enclosing class context when available
- parse failures or unsupported files degrade gracefully to token splitting

Default token splitting uses overlapping fixed-size windows, and all chunking
paths are constrained by the embedding provider's maximum input size.

## Retrieval Path

The read path starts with a Copilot tool call and ends with a structured tool
response.

```text
Copilot invokes tool
  -> ToolHandler resolves target repositories
  -> Retriever.search()
     -> query embedding
     -> sqlite-vec nearest-neighbor search
     -> FTS5 keyword search
     -> path relevance scoring
     -> reciprocal rank fusion
  -> tool-specific formatting
  -> LanguageModelToolResult
```

`Retriever` combines three signals:

- vector similarity from `EmbeddingStore`
- keyword relevance from `ChunkStore` FTS queries
- lightweight path relevance from query tokens vs. file paths

Results are fused with Reciprocal Rank Fusion. Deterministic tools such as
README fetch, file fetch, workflow listing, action listing, and file tree
inspection bypass semantic retrieval when a direct answer is better.

## Built-In Copilot Tools

`ToolManager.registerAll()` currently registers seven built-in tools:

| Tool | Purpose |
|---|---|
| `yoink-search` | Hybrid search across all indexed repos or a specific repository |
| `yoink-list` | Lists indexed repositories and their status |
| `yoink-get-files` | Fetches complete file contents from GitHub, optionally by line range |
| `yoink-get-readme` | Fetches the primary root README or an exact path-scoped README |
| `yoink-file-tree` | Builds a deterministic directory tree from indexed file paths |
| `yoink-list-workflows` | Enumerates indexed GitHub Actions workflow files and triggers |
| `yoink-list-actions` | Enumerates indexed composite actions and their inputs |

Tool metadata lives in `src/tools/*Tool.ts`, while execution logic lives in
`src/tools/toolHandler.ts`.

## GitHub Integration

GitHub access is split across focused components:

- `GitHubAuth` obtains and caches tokens via VS Code authentication
- `GitHubResolver` parses repository URLs and resolves default branches
- `RepoBrowser` supports repository discovery in the add-repo wizard
- `GitHubFetcher` handles tree listing, directory listing, and file fetches
- `DeltaSync` uses GitHub compare data to limit re-indexing to changed files

Yoink indexes remote repositories without requiring a separate MCP server.
Search responses come from the local index, while direct file and README
retrieval fetch current content from GitHub.

## Sync and Lifecycle

`SyncScheduler` starts scheduled work on activation and on a recurring timer.
It delegates sync execution to `DataSourceManager`, which hands off to the
ingestion pipeline.

Operationally important behaviors:

- startup sync can run automatically for sources configured with `onStartup`
- daily sync is driven by the scheduler
- delta sync uses `lastSyncCommitSha`; if absent, Yoink falls back to a full re-index
- deleting a data source removes indexed chunks, embeddings, FTS entries, and associated config state
- interrupted deletions are recovered on startup by `DataSourceManager`

## Storage Model

Yoink stores its local index in `yoink.db` via `better-sqlite3` and
`sqlite-vec`. `src/storage/database.ts` currently manages schema version `4`.

Key tables:

| Table | Type | Purpose |
|---|---|---|
| `meta` | regular | schema version, embedding dimensions, embedding config fingerprint |
| `data_sources` | regular | indexed repository metadata |
| `chunks` | regular | chunk text, file path, line range, token count |
| `sync_history` | regular | per-sync audit history |
| `indexing_runs` | regular | higher-level indexing run tracking |
| `indexing_run_files` | regular | per-file progress within an indexing run |
| `embeddings` | `vec0` virtual table | vector index keyed by `chunk_id` |
| `chunks_fts` | FTS5 virtual table | keyword index over `file_path` and `content` |

The embedding table's dimensions are fixed for a given database. If the user
switches to a provider with incompatible dimensions, Yoink recreates the
embedding table and triggers re-indexing through `EmbeddingManager`.

## Embedding Providers

The embedding subsystem is centered on `EmbeddingProvider` and
`EmbeddingProviderRegistry`.

Current provider modes include:

- OpenAI
- Azure OpenAI
- local test/no-op provider

API keys are stored in VS Code `SecretStorage`, with environment fallback where
supported. They are not stored in `yoink.json`.

## UI and Workspace Integration

The extension UI is intentionally narrow:

- a sidebar tree for data sources and embedding status
- command palette and context-menu actions for add, sync, remove, edit, import, export, and embedding management
- a multi-step add-repository wizard
- optional workspace config import/export via `.vscode/yoink.json`

Yoink also installs bundled Copilot agent markdown files into
`.copilot/agents/` for the current workspace when appropriate.

## Maintainer Notes

- `src/extension.ts` is the best starting point for understanding the live system
- chunking behavior is defined centrally in `Chunker.routeStrategy()`
- every new built-in tool must be added in five places:
  metadata, handler, registration, `package.json`, and agent docs
- storage and retrieval changes should be checked against both schema migration behavior and hybrid ranking behavior
