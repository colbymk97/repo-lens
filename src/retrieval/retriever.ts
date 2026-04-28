import { EmbeddingProvider } from '../embedding/embeddingProvider';
import { ChunkStore, ChunkRecord } from '../storage/chunkStore';
import { EmbeddingStore } from '../storage/embeddingStore';

export interface RetrievalResult {
  chunk: ChunkRecord;
  distance: number;
  diagnostics?: RetrievalDiagnostics;
}

export type RetrievalMode = 'vector-only' | 'fts-only' | 'hybrid-no-path' | 'hybrid';

export interface RetrievalDiagnostics {
  mode: RetrievalMode;
  vectorRank: number | null;
  ftsRank: number | null;
  vectorDistance: number | null;
  ftsScore: number | null;
  pathScore: number;
  rrfScore: number;
  finalScore: number;
  penaltyRank: number;
}

export interface RetrievalSearchOptions {
  mode?: RetrievalMode;
  includeDiagnostics?: boolean;
}

const RRF_K = 60;
const OVER_FETCH = 3;
const PATH_WEIGHT = 0.15;

export class Retriever {
  constructor(
    private readonly chunkStore: ChunkStore,
    private readonly embeddingStore: EmbeddingStore,
  ) {}

  async search(
    query: string,
    dataSourceIds: string[],
    provider: EmbeddingProvider,
    topK: number,
    options: RetrievalSearchOptions = {},
  ): Promise<RetrievalResult[]> {
    const mode = options.mode ?? 'hybrid';
    const fetchK = topK * OVER_FETCH;

    const queryEmbedding =
      mode === 'fts-only'
        ? null
        : (await provider.embed([query]))[0];

    const vecResults =
      queryEmbedding === null
        ? []
        : dataSourceIds.length > 0
          ? this.embeddingStore.search(queryEmbedding, dataSourceIds, fetchK)
          : this.embeddingStore.searchAll(queryEmbedding, fetchK);

    const ftsResults =
      mode === 'vector-only'
        ? []
        : dataSourceIds.length > 0
          ? this.chunkStore.searchFts(query, dataSourceIds, fetchK)
          : this.chunkStore.searchFtsAll(query, fetchK);

    const vecRank = new Map(vecResults.map((r, i) => [r.chunkId, i + 1]));
    const ftsRank = new Map(ftsResults.map((r, i) => [r.chunkId, i + 1]));
    const vecDistance = new Map(vecResults.map((r) => [r.chunkId, r.distance]));
    const ftsScore = new Map(ftsResults.map((r) => [r.chunkId, r.bm25Score]));

    const candidateIds = new Set([
      ...vecResults.map((r) => r.chunkId),
      ...ftsResults.map((r) => r.chunkId),
    ]);

    const penalty = fetchK + 1;
    const queryTokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2);

    const results: RetrievalResult[] = [];
    for (const id of candidateIds) {
      const chunk = this.chunkStore.getById(id);
      if (!chunk) continue;

      const vectorRank = vecRank.get(id) ?? null;
      const keywordRank = ftsRank.get(id) ?? null;
      const vectorDistance = vecDistance.get(id) ?? null;
      const keywordScore = ftsScore.get(id) ?? null;
      const vRank = vectorRank ?? penalty;
      const fRank = keywordRank ?? penalty;
      const rrfScore = 1 / (RRF_K + vRank) + 1 / (RRF_K + fRank);
      const pathScore = pathRelevance(chunk.filePath, queryTokens);
      const finalScore = rankResult(mode, {
        vectorDistance,
        keywordScore,
        rrfScore,
        pathScore,
      });

      if (finalScore === null) continue;

      // Negate so lower distance = better (preserves existing caller contract)
      results.push({
        chunk,
        distance: -finalScore,
        diagnostics: options.includeDiagnostics
          ? {
            mode,
            vectorRank,
            ftsRank: keywordRank,
            vectorDistance,
            ftsScore: keywordScore,
            pathScore,
            rrfScore,
            finalScore,
            penaltyRank: penalty,
          }
          : undefined,
      });
    }

    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, topK);
  }
}

function pathRelevance(filePath: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const lower = filePath.toLowerCase();
  const matches = queryTokens.filter((t) => lower.includes(t)).length;
  return matches / queryTokens.length;
}

function rankResult(
  mode: RetrievalMode,
  scores: {
    vectorDistance: number | null;
    keywordScore: number | null;
    rrfScore: number;
    pathScore: number;
  },
): number | null {
  switch (mode) {
    case 'vector-only':
      return scores.vectorDistance === null ? null : -scores.vectorDistance;
    case 'fts-only':
      return scores.keywordScore;
    case 'hybrid-no-path':
      return scores.rrfScore;
    case 'hybrid':
      return scores.rrfScore + PATH_WEIGHT * scores.pathScore;
  }
}
