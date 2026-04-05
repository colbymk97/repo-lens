import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../../../src/storage/database';
import { DataSourceStore } from '../../../src/storage/dataSourceStore';

describe('DataSourceStore', () => {
  let db: Database.Database;
  let dsStore: DataSourceStore;

  beforeEach(() => {
    db = openDatabase();
    dsStore = new DataSourceStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('inserts and retrieves a data source', () => {
    dsStore.insert('ds1', 'microsoft', 'vscode', 'main');

    const row = dsStore.getById('ds1');
    expect(row).toBeDefined();
    expect(row!.owner).toBe('microsoft');
    expect(row!.repo).toBe('vscode');
    expect(row!.branch).toBe('main');
    expect(row!.status).toBe('queued');
    expect(row!.createdAt).toBeDefined();
  });

  it('returns undefined for non-existent id', () => {
    expect(dsStore.getById('nope')).toBeUndefined();
  });

  it('deletes a data source', () => {
    dsStore.insert('ds1', 'owner', 'repo', 'main');
    dsStore.delete('ds1');
    expect(dsStore.getById('ds1')).toBeUndefined();
  });

  it('inserts with custom status', () => {
    dsStore.insert('ds1', 'owner', 'repo', 'main', 'ready');
    const row = dsStore.getById('ds1');
    expect(row!.status).toBe('ready');
  });
});
