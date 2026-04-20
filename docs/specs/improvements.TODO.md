# Yoink Improvement Analysis

## Context
This summary captures practical improvements for Yoink based on real workflow usage, with special focus on large-file retrieval and multi-file import/export scenarios.

## Highest-Impact Improvements

### 1. Batch Export and Import
- Add a first-class batch export tool to copy multiple files from indexed repositories into workspace paths in one operation.
- Support dry-run previews before writing files.
- Support conflict policies: fail, overwrite, skip, rename.
- Support atomic mode so partial writes do not leave inconsistent state.

### 2. Better Large-File Handling
- Provide reliable full-file streaming for large files.
- Return explicit completeness metadata (bytes, checksum, complete or partial).
- Support resumable retrieval for interrupted transfers.
- Expose a clear response mode: full, excerpt, outline, metadata-only.

### 3. Multi-File Workflow Ergonomics
- Enable search-to-export flow: search results -> select files -> export.
- Allow destination-root mapping with optional source-tree preservation.
- Add per-file progress and final transfer report.

## Additional Improvements by Category

### Retrieval Quality
- Hybrid ranking combining semantic vector similarity, keyword matching, and path relevance.
- Reranking using file-level context, not only chunk-level matches.
- Intent-aware search modes (API usage, workflows, instructions, config).
- Adjacent chunk stitching to reduce fragmented results.

### Performance and Latency
- Cache recent search and file retrieval responses.
- Prefetch top candidate files after search.
- Prioritize interactive requests over background indexing.
- Improve incremental indexing freshness for recently changed repos.

### Reliability and Recovery
- Idempotent job IDs for safe retries.
- Resume from last confirmed offset on transfer failure.
- Structured error taxonomy with actionable guidance.
- Configurable automatic retry with backoff.

### Observability and UX
- Clear operation phases: queued, fetching, writing, verifying, complete.
- Progress bars and ETA for large operations.
- Explicit warnings for truncation, stale index, and partial repository coverage.
- End-of-job scorecard: duration, retries, bytes transferred, failures.

### Governance and Safety
- Secret scanning before workspace writes.
- Policy hooks to block disallowed paths or file types.
- Provenance metadata for imported files.
- Auditable operation log (who, what, when, source).

### Power-User Controls
- Include and exclude path filters.
- Repository weighting and path boosting.
- Confidence thresholds for result quality.
- Deduplication across mirrored repositories or forks.

## Why It Felt Slow in Practice
Even when single-file retrieval works, friction remains in end-to-end workflows:
- Large files may require multi-step handling.
- Multi-file imports require repeated calls.
- Missing one-shot export increases orchestration overhead.
- Limited progress visibility increases perceived latency.

## Proposed New Tool: Batch Export

### Tool Name
yoink-export-files

### Purpose
Export multiple files from an indexed repository directly into workspace paths with preview, conflict handling, verification, and optional atomic writes.

### Example Call Schema
```json
{
  "repository": "owner/repo",
  "files": [
    {
      "sourcePath": "skills/containerize-aspnetcore/SKILL.md",
      "destinationPath": "skills/containerize-aspnetcore/SKILL.md"
    },
    {
      "sourcePath": "instructions/containerization-docker-best-practices.instructions.md",
      "destinationPath": ".github/instructions/containerization-docker-best-practices.instructions.md"
    }
  ],
  "options": {
    "dryRun": false,
    "createDirectories": true,
    "conflictPolicy": "overwrite",
    "atomic": true,
    "verify": "sha256",
    "normalizeLineEndings": "preserve",
    "maxFileBytes": 5242880,
    "maxTotalBytes": 52428800
  }
}
```

### Example Response Schema
```json
{
  "jobId": "exp_01J...",
  "mode": "applied",
  "summary": {
    "requested": 2,
    "exported": 2,
    "skipped": 0,
    "failed": 0,
    "bytesWritten": 183422
  },
  "results": [
    {
      "sourcePath": "skills/containerize-aspnetcore/SKILL.md",
      "destinationPath": "skills/containerize-aspnetcore/SKILL.md",
      "status": "exported",
      "bytes": 50211,
      "checksum": "sha256:..."
    }
  ],
  "warnings": [],
  "errors": []
}
```

### 4. Progressive Large-Result Navigation

Agents currently have no clean way to navigate large search result sets or large directory trees — the pattern of writing to temp files and reading them back is fragile and wasteful. Progressive expansion lets the agent drill down incrementally without exiting the tool interface.

- `yoink-search` and `yoink-file-tree` responses include a cursor or `page` token when results are truncated
- Agent calls the same tool again with `page: 2` (already supported in `yoink-file-tree`; needs adding to search)
- For search: expose an `offset` parameter so the agent can skip already-seen results and ask for the next batch
- For file tree: subtree expansion via `path:` is already implemented; the agent just needs to know when to use it — add an explicit `hasMore: true` hint in the response header when depth was capped
- No temp files, no workspace side-effects, no out-of-band state; everything flows through tool responses

**Why it matters:** agents that need to scan many results today either stop early (missing relevant content) or write intermediate files (fragile, leaves artifacts). Progressive pagination keeps the agent entirely within the tool protocol.

### 5. Batch Get-File

`yoink-get-file` currently fetches one file per call. When an agent needs to read several files — e.g. after a file-tree scan or following up on multiple search hits — it must make N sequential calls. This multiplies latency and burns context budget on repeated tool scaffolding.

- New tool `yoink-get-files` (plural) accepts `files: [{ repository, filePath, startLine?, endLine? }]`
- Returns an array of results, one entry per requested file, in the same order
- Each entry has `status: "ok" | "error" | "skipped"` plus content or error message
- Same binary/size guards as `yoink-get-file` (500 KB limit, binary extension check) applied per file
- `maxFiles` cap (e.g. 10) to prevent accidental over-fetching; agent gets a clear error if exceeded
- Fetches run in parallel (same concurrency pattern as `GitHubFetcher.fetchFiles`)

**Why it matters:** cuts N round-trips to 1 for common agent patterns like "read all files found in the tree" or "get the 3 files referenced in search results." Reduces perceived latency significantly for multi-file workflows.

## Prioritized Roadmap

### Quick Wins (1-2 weeks)
- Add explicit full or excerpt response mode.
- Add completeness metadata and checksums.
- Add progress and ETA for large fetches.
- Add dry-run previews for export plans.
- Add `offset` pagination to `yoink-search` for progressive result navigation.
- Add `hasMore` hint to `yoink-file-tree` responses when depth was capped.

### Medium Lifts (1-2 sprints)
- Implement `yoink-get-files` batch file fetch with parallel fetching and per-file status.
- Implement yoink-export-files with conflict policies.
- Add search-to-export workflow.
- Add resumable transfer and robust retry behavior.
- Add structured operation logs and job summaries.

### Larger Investments
- Atomic transactional multi-file apply with rollback.
- Advanced governance and provenance controls.
- Collaborative query and import recipes for teams.

## Bottom Line
If Yoink adds reliable full-file retrieval plus first-class batch export, most pain in this use case drops significantly. The remaining gains come from better visibility, reliability, and fewer manual orchestration steps.
