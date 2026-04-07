import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeltaSync } from '../../../src/sources/sync/deltaSync';

describe('DeltaSync', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeDeltaSync() {
    return new DeltaSync(async () => 'test-token');
  }

  it('classifies added, modified, and removed files', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [
          { filename: 'new.ts', status: 'added', sha: 'sha-1' },
          { filename: 'changed.ts', status: 'modified', sha: 'sha-2' },
          { filename: 'old.ts', status: 'removed', sha: 'sha-3' },
        ],
      }),
    });

    const ds = makeDeltaSync();
    const result = await ds.computeDelta('owner', 'repo', 'base-sha', 'head-sha');

    expect(result.added).toHaveLength(1);
    expect(result.added[0].path).toBe('new.ts');
    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].path).toBe('changed.ts');
    expect(result.deleted).toEqual(['old.ts']);
    expect(result.newCommitSha).toBe('head-sha');
  });

  it('treats renamed files as modified', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [
          { filename: 'renamed.ts', status: 'renamed', sha: 'sha-1' },
        ],
      }),
    });

    const ds = makeDeltaSync();
    const result = await ds.computeDelta('o', 'r', 'a', 'b');

    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].path).toBe('renamed.ts');
    expect(result.deleted).toHaveLength(0);
  });

  it('throws on API error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const ds = makeDeltaSync();
    await expect(ds.computeDelta('o', 'r', 'a', 'b')).rejects.toThrow('404');
  });

  it('calls correct compare endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ files: [] }),
    });

    const ds = makeDeltaSync();
    await ds.computeDelta('owner', 'repo', 'base123', 'head456');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/repos/owner/repo/compare/base123...head456'),
      expect.anything(),
    );
  });
});
