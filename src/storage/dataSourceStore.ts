import Database from 'better-sqlite3';

export interface DataSourceRow {
  id: string;
  owner: string;
  repo: string;
  branch: string;
  status: string;
  lastSyncedAt: string | null;
  lastSyncCommit: string | null;
  createdAt: string;
}

export class DataSourceStore {
  private readonly insertStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement;
  private readonly getByIdStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO data_sources (id, owner, repo, branch, status)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.deleteStmt = db.prepare('DELETE FROM data_sources WHERE id = ?');
    this.getByIdStmt = db.prepare('SELECT * FROM data_sources WHERE id = ?');
  }

  insert(id: string, owner: string, repo: string, branch: string, status: string = 'queued'): void {
    this.insertStmt.run(id, owner, repo, branch, status);
  }

  delete(id: string): void {
    this.deleteStmt.run(id);
  }

  getById(id: string): DataSourceRow | undefined {
    const row = this.getByIdStmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: row.id as string,
      owner: row.owner as string,
      repo: row.repo as string,
      branch: row.branch as string,
      status: row.status as string,
      lastSyncedAt: row.last_synced_at as string | null,
      lastSyncCommit: row.last_sync_commit as string | null,
      createdAt: row.created_at as string,
    };
  }
}
