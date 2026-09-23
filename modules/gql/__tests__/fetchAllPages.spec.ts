/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages, INDEXER_PAGE_SIZE, MAX_INDEXER_PAGES } from '../fetchAllPages';

const makeRows = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => ({ id: String(offset + i).padStart(8, '0') }));

describe('fetchAllPages', () => {
  it('returns a single short page without requesting another', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(makeRows(3));

    const rows = await fetchAllPages(fetchPage);

    expect(rows).toHaveLength(3);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith('');
  });

  it('follows the cursor past full pages until a page comes back short', async () => {
    const firstPage = makeRows(INDEXER_PAGE_SIZE);
    const secondPage = makeRows(INDEXER_PAGE_SIZE, INDEXER_PAGE_SIZE);
    const lastPage = makeRows(583, 2 * INDEXER_PAGE_SIZE);
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage)
      .mockResolvedValueOnce(lastPage);

    const rows = await fetchAllPages(fetchPage);

    expect(rows).toHaveLength(2 * INDEXER_PAGE_SIZE + 583);
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([
      '',
      firstPage[INDEXER_PAGE_SIZE - 1].id,
      secondPage[INDEXER_PAGE_SIZE - 1].id
    ]);
  });

  it('requests one more page when the result is an exact multiple of the page size', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(makeRows(INDEXER_PAGE_SIZE)).mockResolvedValueOnce([]);

    const rows = await fetchAllPages(fetchPage);

    expect(rows).toHaveLength(INDEXER_PAGE_SIZE);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('throws instead of returning a partial result when every page is full', async () => {
    let page = 0;
    const fetchPage = vi.fn(async () => makeRows(INDEXER_PAGE_SIZE, page++ * INDEXER_PAGE_SIZE));

    await expect(fetchAllPages(fetchPage)).rejects.toThrow(
      `Indexer result exceeds ${MAX_INDEXER_PAGES * INDEXER_PAGE_SIZE} rows`
    );
    expect(fetchPage).toHaveBeenCalledTimes(MAX_INDEXER_PAGES);
  });
});
