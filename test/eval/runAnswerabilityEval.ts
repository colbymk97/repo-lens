import Database from 'better-sqlite3';
import { openDatabase } from '../../src/storage/database';
import { Retriever } from '../../src/retrieval/retriever';
import { ChunkStore } from '../../src/storage/chunkStore';
import { DataSourceStore } from '../../src/storage/dataSourceStore';
import { EmbeddingStore } from '../../src/storage/embeddingStore';
import { loadOpenAIResponsesConfigFromEnv } from './openaiResponses';
import { runSearchAnswerabilityEvaluation } from './searchAnswerabilityHarness';
import { loadSearchEvalDataset, seedSearchEvalCorpus } from './searchEvalHarness';

async function main(): Promise<void> {
  const config = loadOpenAIResponsesConfigFromEnv();
  if (!config) {
    throw new Error('Missing OPENAI_API_KEY for search answerability eval.');
  }

  const dataset = loadSearchEvalDataset();
  const db: Database.Database = openDatabase({ dimensions: dataset.corpus.dimensions });

  try {
    const dataSourceStore = new DataSourceStore(db);
    const chunkStore = new ChunkStore(db);
    const embeddingStore = new EmbeddingStore(db);
    const retriever = new Retriever(chunkStore, embeddingStore);

    seedSearchEvalCorpus(dataset.corpus, {
      dataSourceStore,
      chunkStore,
      embeddingStore,
    });

    const summary = await runSearchAnswerabilityEvaluation(retriever, config, dataset);
    console.log(
      `Search answerability eval complete: ${summary.dataset.promptCount} prompts, ` +
      `${summary.prompts.length} prompt runs`,
    );
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
