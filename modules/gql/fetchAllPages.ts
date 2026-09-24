/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { ApiError } from 'modules/app/api/ApiError';

// The indexer silently caps every response at 1,000 rows, even when a higher limit is requested,
// and reports nothing when it does.
export const INDEXER_PAGE_SIZE = 1000;
export const MAX_INDEXER_PAGES = 100;

// Walks a keyset-paginated query (order_by id asc, id _gt cursor) until a page comes back empty.
// Stopping on a short page would silently truncate again if the indexer's cap dropped below the page size.
// Throws rather than returning a partial result when the page ceiling is reached.
export async function fetchAllPages<T extends { id: string }>(
  fetchPage: (cursor: string) => Promise<T[]>
): Promise<T[]> {
  const rows: T[] = [];
  let cursor = '';

  for (let page = 0; page < MAX_INDEXER_PAGES; page++) {
    const pageRows = await fetchPage(cursor);
    if (pageRows.length === 0) return rows;
    rows.push(...pageRows);
    cursor = pageRows[pageRows.length - 1].id;
  }

  throw new ApiError(
    `Indexer result exceeds ${MAX_INDEXER_PAGES * INDEXER_PAGE_SIZE} rows`,
    500,
    'Error fetching gov polling data'
  );
}
