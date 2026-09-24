/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages, INDEXER_PAGE_SIZE, MAX_INDEXER_PAGES } from '../fetchAllPages';

const makeRows = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => ({ id: String(offset + i).padStart(8, '0') }));

describe('fetchAllPages', () => {
  it('returns an empty result after one request', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce([]);

    expect(await fetchAllPages(fetchPage)).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith('');
  });

  it('keeps paging after a short page in case the indexer cap is below the page size', async () => {
    const firstPage = makeRows(500);
    const secondPage = makeRows(500, 500);
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage)
      .mockResolvedValueOnce([]);

    const rows = await fetchAllPages(fetchPage);

    expect(rows).toHaveLength(1000);
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([
      '',
      firstPage[499].id,
      secondPage[499].id
    ]);
  });

  it('follows the cursor until a page comes back empty', async () => {
    const firstPage = makeRows(INDEXER_PAGE_SIZE);
    const secondPage = makeRows(INDEXER_PAGE_SIZE, INDEXER_PAGE_SIZE);
    const lastPage = makeRows(583, 2 * INDEXER_PAGE_SIZE);
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage)
      .mockResolvedValueOnce(lastPage)
      .mockResolvedValueOnce([]);

    const rows = await fetchAllPages(fetchPage);

    expect(rows).toHaveLength(2 * INDEXER_PAGE_SIZE + 583);
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([
      '',
      firstPage[INDEXER_PAGE_SIZE - 1].id,
      secondPage[INDEXER_PAGE_SIZE - 1].id,
      lastPage[582].id
    ]);
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
