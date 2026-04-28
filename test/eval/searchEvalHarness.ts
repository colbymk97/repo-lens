import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { EmbeddingProvider } from '../../src/embedding/embeddingProvider';
import {
  RetrievalDiagnostics,
  RetrievalMode,
  RetrievalResult,
  Retriever,
} from '../../src/retrieval/retriever';
import { DataSourceStore } from '../../src/storage/dataSourceStore';
import { EmbeddingStore } from '../../src/storage/embeddingStore';
import { ChunkRecord, ChunkStore } from '../../src/storage/chunkStore';

export type SearchEvalIntent =
  | 'semantic-paraphrase'
  | 'identifier-exact'
  | 'path-structure'
  | 'docs-howto'
  | 'workflow-action';

export interface SearchEvalDataSource {
  id: string;
  owner: string;
  repo: string;
  branch: string;
}

export interface SearchEvalChunk extends ChunkRecord {
  embedding: number[];
}

export interface SearchEvalCorpus {
  dimensions: number;
  dataSources: SearchEvalDataSource[];
  chunks: SearchEvalChunk[];
}

export interface SearchEvalRelevantFile {
  repository: string;
  filePath: string;
  grade: number;
}

export interface SearchEvalRelevantChunk {
  chunkId: string;
  grade: number;
}

export interface SearchEvalQuery {
  id: string;
  repository: string | null;
  query: string;
  intent: SearchEvalIntent;
  embedding: number[];
  relevantFiles: SearchEvalRelevantFile[];
  relevantChunks?: SearchEvalRelevantChunk[];
}

export interface SearchEvalDataset {
  corpus: SearchEvalCorpus;
  queries: SearchEvalQuery[];
}

export interface SearchEvalMetrics {
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  recallAt10: number;
  mrrAt10: number;
  ndcgAt10: number;
  successAt5: number;
}

export interface SearchEvalFileResult {
  rank: number;
  repository: string;
  filePath: string;
  chunkId: string;
  startLine: number;
  endLine: number;
  score: number;
  diagnostics?: RetrievalDiagnostics;
}

export interface SearchEvalQueryRun {
  id: string;
  repository: string | null;
  query: string;
  intent: SearchEvalIntent;
  metrics: SearchEvalMetrics;
  chunkHitAt5: boolean | null;
  topFiles: SearchEvalFileResult[];
}

export interface SearchEvalModeSummary {
  overall: SearchEvalMetrics;
  byIntent: Record<SearchEvalIntent, SearchEvalMetrics>;
  queries: SearchEvalQueryRun[];
}

export interface SearchEvalSummary {
  generatedAt: string;
  artifactPath: string;
  topK: number;
  dataset: {
    dimensions: number;
    dataSourceCount: number;
    fileCount: number;
    chunkCount: number;
    queryCount: number;
    queryCountByIntent: Record<SearchEvalIntent, number>;
  };
  modes: Record<RetrievalMode, SearchEvalModeSummary>;
}

const INTENTS: SearchEvalIntent[] = [
  'semantic-paraphrase',
  'identifier-exact',
  'path-structure',
  'docs-howto',
  'workflow-action',
];

const MODES: RetrievalMode[] = [
  'vector-only',
  'fts-only',
  'hybrid-no-path',
  'hybrid',
];

const TOP_K = 10;

const CORPUS_PATH = resolve(__dirname, '../fixtures/search-eval/corpus.json');
const QUERIES_PATH = resolve(__dirname, '../fixtures/search-eval/queries.json');
const ARTIFACT_PATH = resolve(__dirname, '../../test-results/search-relevance-summary.json');

export function loadSearchEvalDataset(): SearchEvalDataset {
  const corpus = parseCorpus(JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as unknown);
  const queries = parseQueries(JSON.parse(readFileSync(QUERIES_PATH, 'utf8')) as unknown, corpus.dimensions);

  return { corpus, queries };
}

export function seedSearchEvalCorpus(
  corpus: SearchEvalCorpus,
  stores: {
    dataSourceStore: DataSourceStore;
    chunkStore: ChunkStore;
    embeddingStore: EmbeddingStore;
  },
): void {
  for (const source of corpus.dataSources) {
    stores.dataSourceStore.insert(source.id, source.owner, source.repo, source.branch);
  }

  stores.chunkStore.insertMany(corpus.chunks);
  for (const chunk of corpus.chunks) {
    stores.embeddingStore.insert(chunk.id, chunk.embedding);
  }
}

export function makeSearchEvalProvider(dataset: SearchEvalDataset): EmbeddingProvider {
  const queryEmbeddings = new Map(dataset.queries.map((query) => [query.query, query.embedding]));

  return {
    id: 'search-eval-fixture',
    maxBatchSize: 100,
    maxInputTokens: 16000,
    dimensions: dataset.corpus.dimensions,
    embed: async (texts: string[]) =>
      texts.map((text) => {
        const embedding = queryEmbeddings.get(text);
        if (!embedding) {
          throw new Error(`Missing search-eval embedding for query: ${text}`);
        }
        return embedding;
      }),
    countTokens: (text: string) => Math.ceil(text.length / 4),
  };
}

export async function runSearchEvaluation(
  retriever: Retriever,
  dataset: SearchEvalDataset,
): Promise<SearchEvalSummary> {
  const provider = makeSearchEvalProvider(dataset);
  const repoByDataSourceId = new Map(
    dataset.corpus.dataSources.map((source) => [source.id, `${source.owner}/${source.repo}`]),
  );
  const dataSourceIdByRepo = new Map(
    dataset.corpus.dataSources.map((source) => [`${source.owner}/${source.repo}`, source.id]),
  );

  const modes = Object.fromEntries(
    await Promise.all(
      MODES.map(async (mode) => {
        const queries: SearchEvalQueryRun[] = [];

        for (const query of dataset.queries) {
          const dataSourceIds = resolveQueryScope(query.repository, dataSourceIdByRepo);
          const rawResults = await retriever.search(
            query.query,
            dataSourceIds,
            provider,
            TOP_K,
            { mode, includeDiagnostics: true },
          );
          const topFiles = collapseResultsToFiles(rawResults, repoByDataSourceId);
          const metrics = scoreFileRanking(query, topFiles);
          queries.push({
            id: query.id,
            repository: query.repository,
            query: query.query,
            intent: query.intent,
            metrics,
            chunkHitAt5: scoreChunkHitAt5(query, rawResults),
            topFiles: topFiles.slice(0, TOP_K),
          });
        }

        const summary: SearchEvalModeSummary = {
          overall: averageMetrics(queries),
          byIntent: Object.fromEntries(
            INTENTS.map((intent) => [
              intent,
              averageMetrics(queries.filter((query) => query.intent === intent)),
            ]),
          ) as Record<SearchEvalIntent, SearchEvalMetrics>,
          queries,
        };

        return [mode, summary] as const;
      }),
    ),
  ) as Record<RetrievalMode, SearchEvalModeSummary>;

  const summary: SearchEvalSummary = {
    generatedAt: new Date().toISOString(),
    artifactPath: ARTIFACT_PATH,
    topK: TOP_K,
    dataset: {
      dimensions: dataset.corpus.dimensions,
      dataSourceCount: dataset.corpus.dataSources.length,
      fileCount: new Set(dataset.corpus.chunks.map((chunk) => `${chunk.dataSourceId}:${chunk.filePath}`)).size,
      chunkCount: dataset.corpus.chunks.length,
      queryCount: dataset.queries.length,
      queryCountByIntent: Object.fromEntries(
        INTENTS.map((intent) => [
          intent,
          dataset.queries.filter((query) => query.intent === intent).length,
        ]),
      ) as Record<SearchEvalIntent, number>,
    },
    modes,
  };

  mkdirSync(dirname(ARTIFACT_PATH), { recursive: true });
  writeFileSync(ARTIFACT_PATH, JSON.stringify(summary, null, 2));

  return summary;
}

export function collapseResultsToFiles(
  results: RetrievalResult[],
  repoByDataSourceId: ReadonlyMap<string, string>,
): SearchEvalFileResult[] {
  const collapsed: SearchEvalFileResult[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    const repository = repoByDataSourceId.get(result.chunk.dataSourceId);
    if (!repository) {
      throw new Error(`Missing repository mapping for data source ${result.chunk.dataSourceId}`);
    }

    const key = toFileKey(repository, result.chunk.filePath);
    if (seen.has(key)) continue;
    seen.add(key);
    collapsed.push({
      rank: collapsed.length + 1,
      repository,
      filePath: result.chunk.filePath,
      chunkId: result.chunk.id,
      startLine: result.chunk.startLine,
      endLine: result.chunk.endLine,
      score: Number((-result.distance).toFixed(6)),
      diagnostics: result.diagnostics,
    });
  }

  return collapsed;
}

export function formatSearchEvalReport(summary: SearchEvalSummary): string {
  const lines: string[] = [];
  lines.push('Search relevance benchmark');
  lines.push(
    `dataset: ${summary.dataset.queryCount} queries, ${summary.dataset.fileCount} files, ` +
    `${summary.dataset.chunkCount} chunks, ${summary.dataset.dataSourceCount} repos`,
  );
  lines.push(`artifact: ${summary.artifactPath}`);
  lines.push('');
  lines.push('overall');
  lines.push(formatMetricTable(MODES, summary.modes, (modeSummary) => modeSummary.overall));

  for (const intent of INTENTS) {
    lines.push('');
    lines.push(`${intent} (${summary.dataset.queryCountByIntent[intent]} queries)`);
    lines.push(formatMetricTable(MODES, summary.modes, (modeSummary) => modeSummary.byIntent[intent]));
  }

  return lines.join('\n');
}

function formatMetricTable(
  modes: RetrievalMode[],
  summaries: Record<RetrievalMode, SearchEvalModeSummary>,
  pickMetrics: (summary: SearchEvalModeSummary) => SearchEvalMetrics,
): string {
  const rows = [
    ['mode', 'R@1', 'R@3', 'R@5', 'R@10', 'MRR@10', 'nDCG@10', 'S@5'],
    ...modes.map((mode) => {
      const metrics = pickMetrics(summaries[mode]);
      return [
        mode,
        formatMetric(metrics.recallAt1),
        formatMetric(metrics.recallAt3),
        formatMetric(metrics.recallAt5),
        formatMetric(metrics.recallAt10),
        formatMetric(metrics.mrrAt10),
        formatMetric(metrics.ndcgAt10),
        formatMetric(metrics.successAt5),
      ];
    }),
  ];

  const widths = rows[0].map((_, columnIndex) =>
    Math.max(...rows.map((row) => row[columnIndex].length)),
  );

  return rows
    .map((row) => row.map((cell, index) => cell.padEnd(widths[index])).join('  '))
    .join('\n');
}

function formatMetric(value: number): string {
  return value.toFixed(3);
}

function scoreFileRanking(
  query: SearchEvalQuery,
  results: SearchEvalFileResult[],
): SearchEvalMetrics {
  const relevant = new Map(
    query.relevantFiles.map((file) => [toFileKey(file.repository, file.filePath), file.grade]),
  );
  const relevantCount = relevant.size;
  const top10 = results.slice(0, TOP_K);
  const recallAt = (limit: number) =>
    top10
      .slice(0, limit)
      .filter((result) => relevant.has(toFileKey(result.repository, result.filePath)))
      .length / relevantCount;

  const firstRelevantRank =
    top10.find((result) => relevant.has(toFileKey(result.repository, result.filePath)))?.rank ?? null;

  return {
    recallAt1: recallAt(1),
    recallAt3: recallAt(3),
    recallAt5: recallAt(5),
    recallAt10: recallAt(10),
    mrrAt10: firstRelevantRank ? 1 / firstRelevantRank : 0,
    ndcgAt10: scoreNdcgAt10(query, top10),
    successAt5:
      top10
        .slice(0, 5)
        .some((result) => relevant.has(toFileKey(result.repository, result.filePath)))
        ? 1
        : 0,
  };
}

function scoreNdcgAt10(query: SearchEvalQuery, results: SearchEvalFileResult[]): number {
  const grades = new Map(
    query.relevantFiles.map((file) => [toFileKey(file.repository, file.filePath), file.grade]),
  );

  const dcg = results.slice(0, TOP_K).reduce((sum, result, index) => {
    const grade = grades.get(toFileKey(result.repository, result.filePath)) ?? 0;
    return sum + ((2 ** grade) - 1) / Math.log2(index + 2);
  }, 0);

  const idcg = [...grades.values()]
    .sort((a, b) => b - a)
    .slice(0, TOP_K)
    .reduce((sum, grade, index) => sum + ((2 ** grade) - 1) / Math.log2(index + 2), 0);

  return idcg === 0 ? 0 : dcg / idcg;
}

function scoreChunkHitAt5(query: SearchEvalQuery, results: RetrievalResult[]): boolean | null {
  if (!query.relevantChunks?.length) return null;
  const relevant = new Set(query.relevantChunks.map((chunk) => chunk.chunkId));
  return results.slice(0, 5).some((result) => relevant.has(result.chunk.id));
}

function averageMetrics(queries: SearchEvalQueryRun[]): SearchEvalMetrics {
  const denominator = queries.length || 1;

  return {
    recallAt1: sumMetric(queries, (query) => query.metrics.recallAt1) / denominator,
    recallAt3: sumMetric(queries, (query) => query.metrics.recallAt3) / denominator,
    recallAt5: sumMetric(queries, (query) => query.metrics.recallAt5) / denominator,
    recallAt10: sumMetric(queries, (query) => query.metrics.recallAt10) / denominator,
    mrrAt10: sumMetric(queries, (query) => query.metrics.mrrAt10) / denominator,
    ndcgAt10: sumMetric(queries, (query) => query.metrics.ndcgAt10) / denominator,
    successAt5: sumMetric(queries, (query) => query.metrics.successAt5) / denominator,
  };
}

function sumMetric(
  queries: SearchEvalQueryRun[],
  pick: (query: SearchEvalQueryRun) => number,
): number {
  return queries.reduce((sum, query) => sum + pick(query), 0);
}

function resolveQueryScope(
  repository: string | null,
  dataSourceIdByRepo: ReadonlyMap<string, string>,
): string[] {
  if (!repository) return [];
  const dataSourceId = dataSourceIdByRepo.get(repository);
  if (!dataSourceId) {
    throw new Error(`Unknown search-eval repository scope: ${repository}`);
  }
  return [dataSourceId];
}

function toFileKey(repository: string, filePath: string): string {
  return `${repository}:${filePath}`;
}

function parseCorpus(input: unknown): SearchEvalCorpus {
  if (!isRecord(input)) {
    throw new Error('search-eval corpus must be an object');
  }

  const dimensions = asNumber(input.dimensions, 'corpus.dimensions');
  const dataSources = asArray(input.dataSources, 'corpus.dataSources').map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`corpus.dataSources[${index}] must be an object`);
    }
    return {
      id: asString(entry.id, `corpus.dataSources[${index}].id`),
      owner: asString(entry.owner, `corpus.dataSources[${index}].owner`),
      repo: asString(entry.repo, `corpus.dataSources[${index}].repo`),
      branch: asString(entry.branch, `corpus.dataSources[${index}].branch`),
    };
  });
  const chunks = asArray(input.chunks, 'corpus.chunks').map((entry, index) =>
    parseChunk(entry, index, dimensions),
  );

  return { dimensions, dataSources, chunks };
}

function parseQueries(input: unknown, dimensions: number): SearchEvalQuery[] {
  return asArray(input, 'queries').map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`queries[${index}] must be an object`);
    }

    return {
      id: asString(entry.id, `queries[${index}].id`),
      repository:
        entry.repository === null
          ? null
          : asString(entry.repository, `queries[${index}].repository`),
      query: asString(entry.query, `queries[${index}].query`),
      intent: asIntent(entry.intent, `queries[${index}].intent`),
      embedding: asEmbedding(entry.embedding, `queries[${index}].embedding`, dimensions),
      relevantFiles: asArray(entry.relevantFiles, `queries[${index}].relevantFiles`).map(
        (file, fileIndex) => parseRelevantFile(file, index, fileIndex),
      ),
      relevantChunks:
        entry.relevantChunks === undefined
          ? undefined
          : asArray(entry.relevantChunks, `queries[${index}].relevantChunks`).map(
            (chunk, chunkIndex) => parseRelevantChunk(chunk, index, chunkIndex),
          ),
    };
  });
}

function parseChunk(input: unknown, index: number, dimensions: number): SearchEvalChunk {
  if (!isRecord(input)) {
    throw new Error(`corpus.chunks[${index}] must be an object`);
  }

  return {
    id: asString(input.id, `corpus.chunks[${index}].id`),
    dataSourceId: asString(input.dataSourceId, `corpus.chunks[${index}].dataSourceId`),
    filePath: asString(input.filePath, `corpus.chunks[${index}].filePath`),
    startLine: asNumber(input.startLine, `corpus.chunks[${index}].startLine`),
    endLine: asNumber(input.endLine, `corpus.chunks[${index}].endLine`),
    tokenCount: asNumber(input.tokenCount, `corpus.chunks[${index}].tokenCount`),
    content: asString(input.content, `corpus.chunks[${index}].content`),
    embedding: asEmbedding(input.embedding, `corpus.chunks[${index}].embedding`, dimensions),
  };
}

function parseRelevantFile(
  input: unknown,
  queryIndex: number,
  fileIndex: number,
): SearchEvalRelevantFile {
  if (!isRecord(input)) {
    throw new Error(`queries[${queryIndex}].relevantFiles[${fileIndex}] must be an object`);
  }

  return {
    repository: asString(
      input.repository,
      `queries[${queryIndex}].relevantFiles[${fileIndex}].repository`,
    ),
    filePath: asString(
      input.filePath,
      `queries[${queryIndex}].relevantFiles[${fileIndex}].filePath`,
    ),
    grade: asNumber(input.grade, `queries[${queryIndex}].relevantFiles[${fileIndex}].grade`),
  };
}

function parseRelevantChunk(
  input: unknown,
  queryIndex: number,
  chunkIndex: number,
): SearchEvalRelevantChunk {
  if (!isRecord(input)) {
    throw new Error(`queries[${queryIndex}].relevantChunks[${chunkIndex}] must be an object`);
  }

  return {
    chunkId: asString(
      input.chunkId,
      `queries[${queryIndex}].relevantChunks[${chunkIndex}].chunkId`,
    ),
    grade: asNumber(input.grade, `queries[${queryIndex}].relevantChunks[${chunkIndex}].grade`),
  };
}

function asIntent(input: unknown, label: string): SearchEvalIntent {
  const value = asString(input, label);
  if (!INTENTS.includes(value as SearchEvalIntent)) {
    throw new Error(`${label} must be one of ${INTENTS.join(', ')}`);
  }
  return value as SearchEvalIntent;
}

function asEmbedding(input: unknown, label: string, dimensions: number): number[] {
  const embedding = asArray(input, label).map((value, index) =>
    asNumber(value, `${label}[${index}]`),
  );
  if (embedding.length !== dimensions) {
    throw new Error(`${label} must have ${dimensions} dimensions, got ${embedding.length}`);
  }
  return embedding;
}

function asArray(input: unknown, label: string): unknown[] {
  if (!Array.isArray(input)) {
    throw new Error(`${label} must be an array`);
  }
  return input;
}

function asString(input: unknown, label: string): string {
  if (typeof input !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  return input;
}

function asNumber(input: unknown, label: string): number {
  if (typeof input !== 'number' || Number.isNaN(input)) {
    throw new Error(`${label} must be a number`);
  }
  return input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}
