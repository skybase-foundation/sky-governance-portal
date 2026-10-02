/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

const RAW_GITHUB_HOST = 'raw.githubusercontent.com';

/**
 * Turns a raw GitHub content URL into the matching blob page anchored at its
 * review section. Returns '' for anything that is not https raw GitHub
 * content, so a poll cannot point the review button at an arbitrary target.
 */
export function parseRawUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' || url.hostname !== RAW_GITHUB_HOST) return '';
  const [org, repo, ...route] = url.pathname.split('/').filter(Boolean);
  if (!org || !repo || route.length === 0) return '';
  return `https://github.com/${org}/${repo}/blob/${route.join('/')}#review`;
}
